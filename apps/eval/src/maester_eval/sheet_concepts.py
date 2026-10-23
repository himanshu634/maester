"""A PDF fact's concept, from the concepts the investor recorded in the company's labelling sheets.

The rule (`CONCEPT_CARRY_VERSION`): a concept comes from a `concept` cell of any sheet of the same company, keyed by
statement, normalised section and normalised label; without the section, by statement and label alone, but only when
that label never carries two concepts in the company's sheets. This is the data layer's override (a concept for a line
of a company, by label). Never by value, and never by a match between labels and the element map's labels: either
would hide the disagreements `compare` measures. A fact with no carried concept has no concept, not a guess.

A row counts when its concept is in the taxonomy and in the family of the row's statement; `verified` does not matter.
Only `sheets_dir/<company folder>/*.csv` is read, so another company's rows and the settle sheets never reach it."""

from dataclasses import dataclass
from pathlib import Path
from typing import Literal

from maester_eval.concepts import Taxonomy
from maester_eval.gold import read_sheet
from maester_eval.text import normalise

CONCEPT_CARRY_VERSION = 1

# Each key to the concepts its rows gave and, for each concept, the filings whose own sheet gave it.
_Given = dict[tuple[str, ...], dict[str, set[str]]]


@dataclass(frozen=True)
class ConceptPick:
    concept: str
    source: Literal["own", "company"]


@dataclass(frozen=True)
class CompanyConcepts:
    _by_section: _Given
    _by_label: _Given

    def lookup(self, filing_id: str, statement: str, section: str, label: str) -> ConceptPick | None:
        """The concept for a line, or None. Section and label first, then the label alone when it is unique.

        `own` when a row of `filing_id`'s own sheet gave the key, otherwise `company`."""
        for given, key in ((self._by_section, (statement, normalise(section), normalise(label))),
                           (self._by_label, (statement, normalise(label)))):
            concepts = given.get(key)
            if concepts is None:
                continue
            if len(concepts) > 1:
                # Two concepts under one key: the label is ambiguous here, and the label alone is then ambiguous too.
                return None
            ((concept, filings),) = concepts.items()
            return ConceptPick(concept, "own" if filing_id in filings else "company")
        return None


def load_company_concepts(sheets_dir: Path, company_folder: str, taxonomy: Taxonomy) -> CompanyConcepts:
    by_section: _Given = {}
    by_label: _Given = {}
    for path in sorted((sheets_dir / company_folder).glob("*.csv")):
        filing_id = f"{company_folder}/{path.stem}"
        for row in read_sheet(path):
            concept = taxonomy.get(row.get("concept", ""))
            statement = row.get("statement", "")
            if concept is None or concept.family != statement:
                continue
            label = normalise(row.get("label", ""))
            for given, key in ((by_section, (statement, normalise(row.get("section", "")), label)),
                               (by_label, (statement, label))):
                given.setdefault(key, {}).setdefault(concept.id, set()).add(filing_id)
    return CompanyConcepts(by_section, by_label)
