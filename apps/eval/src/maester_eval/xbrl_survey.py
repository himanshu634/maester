"""A survey of XBRL instances: which numeric elements each format holds, and how often. No value is read out.

`maester-eval xbrl-elements` reads every `.xml` under a folder with the engine's own parser and detects its
format from its elements, as the extractor does. For each format it writes `elements-<format id, / as ->.csv`
with one row per numeric element:

    element, files, contexts, statement_guess

`files` is the number of instances in which the element has a fact. `contexts` is the number of distinct
context ids its facts use across the format's instances (`OneD`, `FourD`, `OneI`, `PY_I`, ...).
`statement_guess` is `balance_sheet` when every fact of the element is in an instant context, and `duration`
otherwise: a hint for drafting an element map, not a classification.

Only a fact in a context without a dimension counts, because a fact with a member is the detail of a line and
the maps hold lines. Only a numeric fact counts (one with a unit, a nil one included, as format detection
does). The output holds element names and counts and nothing else: not a value, not a company name, not a code.
An instance that cannot be read is counted under the reason code the parser gave, and does not stop the run.
"""

import csv
import io
from collections import Counter
from dataclasses import dataclass, field
from pathlib import Path

from pdf_financial_qa.workflow.errors import ExtractionError
from pdf_financial_qa.xbrl.formats import detect_format
from pdf_financial_qa.xbrl.parser import Instance, parse_instance

from maester_eval.errors import EvalError
from maester_eval.files import write_text_atomically

COLUMNS = ("element", "files", "contexts", "statement_guess")

# The extractor's limits (XBRL_MAX_BYTES, XBRL_MAX_FACTS, XBRL_DEADLINE_SECONDS): a file it would refuse is
# counted here as unreadable.
_MAX_BYTES = 20971520
_MAX_FACTS = 100000
_DEADLINE_SECONDS = 30.0


class XbrlSurveyError(EvalError):
    """The folder to survey is not a folder, or holds no `.xml` file."""


@dataclass
class ElementCount:
    files: int = 0
    contexts: set[str] = field(default_factory=set)
    instants_only: bool = True

    @property
    def statement_guess(self) -> str:
        return "balance_sheet" if self.instants_only else "duration"


@dataclass
class Survey:
    """``formats`` counts the readable instances by format id; ``no_format`` those in no known family;
    ``unreadable`` the refused files by the parser's reason code; ``elements`` the numeric elements by
    format id."""

    formats: dict[str, int] = field(default_factory=dict)
    no_format: int = 0
    unreadable: dict[str, int] = field(default_factory=dict)
    elements: dict[str, dict[str, ElementCount]] = field(default_factory=dict)

    @property
    def files(self) -> int:
        return sum(self.formats.values()) + self.no_format + sum(self.unreadable.values())


def find_instances(folder: Path) -> list[Path]:
    """Every `.xml` file under ``folder``, in a fixed order."""
    if not folder.is_dir():
        raise XbrlSurveyError(f"{folder} is not a folder")
    found = sorted(path for path in folder.rglob("*") if path.is_file() and path.suffix.lower() == ".xml")
    if not found:
        raise XbrlSurveyError(f"no .xml files under {folder}")
    return found


def survey_instances(paths: list[Path]) -> Survey:
    survey = Survey()
    formats: Counter[str] = Counter()
    unreadable: Counter[str] = Counter()
    for path in paths:
        try:
            instance = parse_instance(
                path.read_bytes(),
                max_bytes=_MAX_BYTES,
                max_facts=_MAX_FACTS,
                deadline_seconds=_DEADLINE_SECONDS,
            )
        except ExtractionError as refused:
            unreadable[refused.message] += 1  # the parser's message is its reason code and nothing else
            continue
        format_id = detect_format(instance).id
        if format_id is None:
            survey.no_format += 1
            continue
        formats[format_id] += 1
        _add(survey.elements.setdefault(format_id, {}), instance)
    survey.formats = dict(formats)
    survey.unreadable = dict(unreadable)
    return survey


def _add(counts: dict[str, ElementCount], instance: Instance) -> None:
    """The numeric elements of one instance, with the contexts of their facts, added to ``counts``."""
    contexts: dict[str, set[str]] = {}
    instant_only: dict[str, bool] = {}
    for fact in instance.facts:
        if fact.unit_id is None:
            continue
        context = instance.contexts.get(fact.context_id)
        if context is None or context.dimensional:
            continue
        contexts.setdefault(fact.element, set()).add(context.id)
        instant_only[fact.element] = instant_only.get(fact.element, True) and context.instant is not None
    for element, ids in contexts.items():
        count = counts.setdefault(element, ElementCount())
        count.files += 1
        count.contexts |= ids
        count.instants_only = count.instants_only and instant_only[element]


def csv_name(format_id: str) -> str:
    return f"elements-{format_id.replace('/', '-')}.csv"


def write_survey(survey: Survey, out_dir: Path) -> list[Path]:
    """One CSV per format that was read, rows in element order. Returns the files written, in format order."""
    written: list[Path] = []
    for format_id in sorted(survey.formats):
        buffer = io.StringIO()
        writer = csv.writer(buffer, lineterminator="\n")
        writer.writerow(COLUMNS)
        for element, count in sorted(survey.elements.get(format_id, {}).items()):
            writer.writerow([element, count.files, len(count.contexts), count.statement_guess])
        path = out_dir / csv_name(format_id)
        write_text_atomically(path, buffer.getvalue())
        written.append(path)
    return written
