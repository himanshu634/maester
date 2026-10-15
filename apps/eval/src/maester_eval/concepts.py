"""The taxonomy, packages/contracts/concepts.json, as the gold set's vocabulary.

Phase 1 gives the taxonomy a TypeScript loader and a generated Python copy in the
engine; until then the harness reads the JSON file directly.
"""

import json
from pathlib import Path
from typing import Literal

from pydantic import BaseModel, ConfigDict

from maester_eval.paths import CONCEPTS_PATH

Family = Literal[
    "income_statement", "balance_sheet", "cash_flow",
    "segment_note", "borrowings_note", "share_capital_note", "dividend_note", "related_party_note",
]
ConceptKind = Literal["monetary", "per_share", "count"]
PeriodType = Literal["duration", "instant"]


class Concept(BaseModel):
    # Phase 1 adds sum_of, cross_check, dimensions and notes; the harness ignores what it does not know.
    model_config = ConfigDict(extra="allow")

    id: str
    label: str
    family: Family
    kind: ConceptKind
    period_type: PeriodType


class Taxonomy(BaseModel):
    model_config = ConfigDict(extra="forbid")

    taxonomy_version: int
    concepts: list[Concept]

    def ids(self) -> set[str]:
        return {c.id for c in self.concepts}

    def get(self, concept_id: str) -> Concept | None:
        return next((c for c in self.concepts if c.id == concept_id), None)


def load_taxonomy(path: Path = CONCEPTS_PATH) -> Taxonomy:
    return Taxonomy.model_validate(json.loads(path.read_text()))
