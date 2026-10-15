"""The corpus manifest: which filings exist, whose they are, and which set each belongs to.

A company is in one set only, so nothing tuned on `dev` has seen a `heldout` filing.
"""

from datetime import date
import json
from pathlib import Path
import re
from typing import Literal

from pydantic import BaseModel, ConfigDict, ValidationError, field_validator

FilingKind = Literal["annual_report", "financial_results"]
EvalSet = Literal["dev", "heldout"]
Stratum = Literal["large", "mid", "small", "financials"]
SetChoice = Literal["dev", "heldout", "all"]


class ManifestError(ValueError):
    pass


class Filing(BaseModel):
    model_config = ConfigDict(extra="forbid")

    file: str
    company: str
    kind: FilingKind
    period_end: str
    set: EvalSet
    # The size band the split was stratified by; banks and NBFCs are their own stratum.
    stratum: Stratum | None = None
    # Why a baseline should leave this filing out, such as statements the taxonomy does not cover yet.
    out_of_scope: str | None = None
    # 2 when each PDF page is a spread of two printed pages, so page N of the PDF holds printed pages 2N-1 and 2N.
    printed_pages_per_page: Literal[1, 2] = 1

    @property
    def id(self) -> str:
        return re.sub(r"\.pdf$", "", self.file, flags=re.IGNORECASE)

    @field_validator("file")
    @classmethod
    def _relative_pdf(cls, value: str) -> str:
        parts = Path(value).parts
        if value.startswith("/") or ".." in parts or len(parts) < 2 or not value.lower().endswith(".pdf"):
            raise ValueError("file must be `<company-folder>/<name>.pdf`, relative to the corpus")
        return value

    @field_validator("period_end")
    @classmethod
    def _iso_date(cls, value: str) -> str:
        date.fromisoformat(value)
        return value


class Manifest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    filings: list[Filing]

    def by_id(self) -> dict[str, Filing]:
        return {f.id: f for f in self.filings}

    def select(self, eval_set: SetChoice = "all", only: list[str] | None = None) -> list[Filing]:
        chosen = [f for f in self.filings if eval_set == "all" or f.set == eval_set]
        if only:
            known = self.by_id()
            unknown = [i for i in only if i not in known]
            if unknown:
                raise ManifestError(f"not in the manifest: {', '.join(unknown)}")
            chosen = [f for f in chosen if f.id in set(only)]
        return chosen


def load_manifest(path: Path) -> Manifest:
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError:
        raise ManifestError(f"no manifest at {path}") from None
    try:
        manifest = Manifest.model_validate(data)
    except ValidationError as exc:
        raise ManifestError(str(exc)) from None
    ids = [f.id for f in manifest.filings]
    duplicates = sorted({i for i in ids if ids.count(i) > 1})
    if duplicates:
        raise ManifestError(f"duplicate filing ids: {', '.join(duplicates)}")
    sets: dict[str, set[str]] = {}
    for filing in manifest.filings:
        sets.setdefault(filing.company, set()).add(filing.set)
    mixed = sorted(company for company, members in sets.items() if len(members) > 1)
    if mixed:
        raise ManifestError(f"a company must be in one set only: {', '.join(mixed)}")
    return manifest


def missing_files(manifest: Manifest, corpus: Path) -> list[str]:
    return [f.file for f in manifest.filings if not (corpus / f.file).is_file()]
