"""The corpus manifest: which filings exist, whose they are, and which set each belongs to.

A company is in one set only, so nothing tuned on `dev` has seen a `heldout` filing. A company is
told by its name, with case, punctuation and spacing ignored, and by its corpus folder.
"""

from datetime import date
import json
from pathlib import Path
import re
from typing import Literal

from pydantic import BaseModel, ConfigDict, ValidationError, field_validator, model_validator

from maester_eval.errors import EvalError
from maester_eval.files import write_text_atomically
from maester_eval.text import normalise

FilingKind = Literal["annual_report", "financial_results"]
EvalSet = Literal["dev", "heldout"]
Stratum = Literal["large", "mid", "small", "financials"]
SetChoice = Literal["dev", "heldout", "all"]
Unit = Literal["lakh", "crore", "thousand", "million", "rupees"]
Basis = Literal["consolidated", "standalone"]

# BSE's period token as its CSV writes it, such as `SQ2025-2026`. The second year is the first plus one.
_PERIOD_TOKEN = re.compile(r"(JQ|SQ|SH|DQ|DN|MQ|MH|MC)([0-9]{4})-([0-9]{4})")
# (month, day, years after the first year) of the last day of the period a token's letters name.
_PERIOD_END = {"JQ": (6, 30, 0), "SQ": (9, 30, 0), "SH": (9, 30, 0), "DQ": (12, 31, 0), "DN": (12, 31, 0),
               "MQ": (3, 31, 1), "MH": (3, 31, 1), "MC": (3, 31, 1)}


class ManifestError(EvalError, ValueError):
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


def period_end_of_token(token: str) -> date:
    """The last day of the period a BSE token names.

    JQ is 30 June of the first year; SQ and SH, 30 September of the first year; DQ and DN, 31 December of the
    first year; MQ, MH and MC, 31 March of the second year. The token is upper case. Anything else is a `ValueError`.
    """
    match = _PERIOD_TOKEN.fullmatch(token)
    if match is None:
        raise ValueError(f"not a BSE period token: {token!r}")
    letters, first, second = match.group(1), int(match.group(2)), int(match.group(3))
    if second != first + 1:
        raise ValueError(f"the second year of {token!r} is not the first year plus one")
    month, day, extra = _PERIOD_END[letters]
    return date(first + extra, month, day)


class XbrlPair(BaseModel):
    """One XBRL instance BSE filed for a results filing."""

    model_config = ConfigDict(extra="forbid")

    # `<company-folder>/xbrl/<name>.xml`, relative to the corpus.
    file: str
    basis: Basis
    # BSE's token as the CSV writes it.
    period: str
    # An ISO date.
    filed: str
    # The format id from `detect_format` when paired, such as `in-capmkt/ind_as`; null when unreadable.
    format: str | None

    @field_validator("file")
    @classmethod
    def _xbrl_path(cls, value: str) -> str:
        path = Path(value)
        if (value != path.as_posix() or value.startswith("/") or ".." in path.parts or len(path.parts) != 3
                or path.parts[1] != "xbrl" or not value.endswith(".xml")):
            raise ValueError("file must be `<company-folder>/xbrl/<name>.xml`, relative to the corpus")
        return value

    @field_validator("period")
    @classmethod
    def _period_token(cls, value: str) -> str:
        period_end_of_token(value)
        return value

    @field_validator("filed")
    @classmethod
    def _iso_filed(cls, value: str) -> str:
        if not is_iso_date(value):
            raise ValueError("filed must be a calendar date written YYYY-MM-DD")
        return value


class FormatTags(BaseModel):
    """How a filing prints its figures, as its own XBRL or the investor says. Null is not tagged."""

    model_config = ConfigDict(extra="forbid")

    unit: Unit | None = None
    unit_from: Literal["xbrl", "investor"] | None = None
    negatives_in_brackets: bool | None = None
    restated_columns: bool | None = None


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
    # BSE's six-digit scrip code, which pairs a results filing with the instances BSE filed for it.
    bse_code: str | None = None
    # The XBRL instances paired with a results filing, one per basis.
    xbrl: list[XbrlPair] = []
    tags: FormatTags | None = None

    @property
    def id(self) -> str:
        return re.sub(r"\.pdf$", "", self.file, flags=re.IGNORECASE)

    @property
    def company_folder(self) -> str:
        return Path(self.file).parts[0]

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

    @field_validator("bse_code")
    @classmethod
    def _six_digits(cls, value: str | None) -> str | None:
        if value is not None and not re.fullmatch(r"[0-9]{6}", value):
            raise ValueError("bse_code must be six digits")
        return value

    @model_validator(mode="after")
    def _pairs_belong(self) -> "Filing":
        if not self.xbrl:
            return self
        if self.kind != "financial_results":
            raise ValueError("only a financial_results filing is paired with XBRL instances")
        if self.bse_code is None:
            raise ValueError("a filing with XBRL instances needs a bse_code")
        for pair in self.xbrl:
            if Path(pair.file).parts[0] != self.company_folder:
                raise ValueError(f"{pair.file} is not under {self.company_folder}/xbrl/")
            if period_end_of_token(pair.period).isoformat() != self.period_end:
                raise ValueError(f"{pair.file}: period {pair.period} does not end on {self.period_end}")
        return self


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


def write_manifest(path: Path, manifest: Manifest) -> None:
    """Write the manifest as the committed file is written: two-space indent, defaults left out, a final newline."""
    filings = [f.model_dump(mode="json", exclude_defaults=True) for f in manifest.filings]
    write_text_atomically(path, json.dumps({"filings": filings}, indent=2, ensure_ascii=False) + "\n")


def tag_values(filing: Filing) -> dict[str, str]:
    """A filing's format tags in words, for a report's breakdown. A value nobody tagged is `not tagged`."""
    tags = filing.tags or FormatTags()

    def flag(value: bool | None) -> str:
        return "not tagged" if value is None else "yes" if value else "no"

    return {"unit": tags.unit or "not tagged", "brackets": flag(tags.negatives_in_brackets),
            "restated": flag(tags.restated_columns),
            "spreads": "yes" if filing.printed_pages_per_page == 2 else "no",
            "financials": "yes" if filing.stratum == "financials" else "no"}


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
