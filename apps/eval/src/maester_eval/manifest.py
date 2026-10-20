"""The corpus manifest: which filings exist, whose they are, and which set each belongs to.

A company is in one set only, so nothing tuned on `dev` has seen a `heldout` filing. A company is
told by its name, with case, punctuation and spacing ignored, and by its corpus folder.
"""

from datetime import date
import json
from pathlib import Path
import re
from typing import Literal

from pydantic import BaseModel, ConfigDict, ValidationError, field_validator

from maester_eval.text import normalise

FilingKind = Literal["annual_report", "financial_results"]
EvalSet = Literal["dev", "heldout"]
Stratum = Literal["large", "mid", "small", "financials"]
SetChoice = Literal["dev", "heldout", "all"]


class ManifestError(ValueError):
    pass


def is_iso_date(text: str) -> bool:
    """A calendar date written YYYY-MM-DD."""
    if not re.fullmatch(r"[0-9]{4}-[0-9]{2}-[0-9]{2}", text):
        return False
    try:
        date.fromisoformat(text)
    except ValueError:
        return False
    return True


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
        path = Path(value)
        if (value != path.as_posix() or value.startswith("/") or ".." in path.parts or len(path.parts) < 2
                or not value.lower().endswith(".pdf")):
            raise ValueError("file must be `<company-folder>/<name>.pdf`, relative to the corpus (no `./`, no `//`)")
        return value

    @field_validator("period_end")
    @classmethod
    def _iso_date(cls, value: str) -> str:
        if not is_iso_date(value):
            raise ValueError("period_end must be a calendar date written YYYY-MM-DD")
        return value


class Manifest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    filings: list[Filing]

    def by_id(self) -> dict[str, Filing]:
        return {f.id: f for f in self.filings}

    def _in_set(self, eval_set: SetChoice) -> list[Filing]:
        return [f for f in self.filings if eval_set == "all" or f.set == eval_set]

    def select(self, eval_set: SetChoice = "all", only: list[str] | None = None) -> list[Filing]:
        """The filings of a set, in manifest order.

        A filing marked out of scope is left out unless `only` names it: naming a filing is explicit.
        """
        chosen = self._in_set(eval_set)
        if only:
            known = self.by_id()
            unknown = [i for i in only if i not in known]
            if unknown:
                raise ManifestError(f"not in the manifest: {', '.join(unknown)}")
            wanted = set(only)
            outside = [f for f in self.filings if f.id in wanted and eval_set != "all" and f.set != eval_set]
            if outside:
                raise ManifestError("; ".join(f"{f.id} is in set {f.set}, not {eval_set}" for f in outside))
            return [f for f in chosen if f.id in wanted]
        skipped = {f.id for f in self.out_of_scope(eval_set)}
        return [f for f in chosen if f.id not in skipped]

    def out_of_scope(self, eval_set: SetChoice = "all") -> list[Filing]:
        """The filings of a set that a baseline leaves out, in manifest order.

        A command uses it to say how many filings it skipped.
        """
        return [f for f in self._in_set(eval_set) if f.out_of_scope is not None]


def load_manifest(path: Path) -> Manifest:
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError:
        raise ManifestError(f"no manifest at {path}") from None
    except (json.JSONDecodeError, UnicodeDecodeError) as exc:
        raise ManifestError(f"{path} is not valid JSON: {exc}") from None
    try:
        manifest = Manifest.model_validate(data)
    except ValidationError as exc:
        raise ManifestError(str(exc)) from None
    ids = [f.id for f in manifest.filings]
    duplicates = sorted({i for i in ids if ids.count(i) > 1})
    if duplicates:
        raise ManifestError(f"duplicate filing ids: {', '.join(duplicates)}")
    mixed = _mixed_sets(manifest.filings)
    if mixed:
        raise ManifestError(f"each company and corpus folder must be in one set only: {'; '.join(mixed)}")
    return manifest


def missing_files(filings: list[Filing], corpus: Path) -> list[str]:
    return [f.file for f in filings if not (corpus / f.file).is_file()]


def _mixed_sets(filings: list[Filing]) -> list[str]:
    """The companies and corpus folders that have filings in more than one set, each with its sets.

    A company is told by its name with case, punctuation and spacing ignored, and a folder by the
    first part of `file`: two filings that share either one belong together.
    """
    by_company: dict[str, list[Filing]] = {}
    by_folder: dict[str, list[Filing]] = {}
    for filing in filings:
        by_company.setdefault(normalise(filing.company), []).append(filing)
        by_folder.setdefault(Path(filing.file).parts[0], []).append(filing)

    def split(groups: dict[str, list[Filing]]) -> list[list[Filing]]:
        return [members for members in groups.values() if len({f.set for f in members}) > 1]

    def sets(members: list[Filing]) -> str:
        return ", ".join(sorted({f.set for f in members}))

    def names(members: list[Filing]) -> str:
        return " / ".join(dict.fromkeys(f.company.strip() for f in members))

    companies = [f"{names(members)} ({sets(members)})" for members in split(by_company)]
    folders = [f"folder {Path(members[0].file).parts[0]} ({sets(members)})" for members in split(by_folder)]
    return sorted(companies) + sorted(folders)
