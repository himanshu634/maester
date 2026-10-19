"""Where the harness reads and writes: its own files under the repository's data/eval, the taxonomy under packages/contracts."""

from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
import re

from maester_eval.errors import EvalError

# apps/eval/src/maester_eval/paths.py → the repository root. `parents[4]` holds for a checkout
# or an editable install; the harness is never installed as a wheel elsewhere.
ROOT = Path(__file__).resolve().parents[4]
CONCEPTS_PATH = ROOT / "packages" / "contracts" / "concepts.json"

# What a run label may be. `new_run` checks it and `_RUN_NAME` ends with it, so the two cannot drift apart.
_LABEL = re.compile(r"[A-Za-z0-9._-]+")
# A run folder as `new_run` names it: `20261016T093005Z`, then `-` and the label if there is one.
_RUN_NAME = re.compile(r"\d{8}T\d{6}Z(-" + _LABEL.pattern + ")?")


class RunLabelError(EvalError, ValueError):
    """A run label with a character other than a letter, a digit, a dot, a dash or an underscore."""


class RunNotFoundError(EvalError):
    """`--run` or `--against` does not lead to a run folder."""


def to_utc(moment: datetime | None) -> datetime:
    """`moment` in UTC, or now when there is none. A naive time is taken as UTC already."""
    if moment is None:
        return datetime.now(timezone.utc)
    if moment.utcoffset() is None:
        moment = moment.replace(tzinfo=timezone.utc)
    return moment.astimezone(timezone.utc)


@dataclass(frozen=True)
class EvalPaths:
    base: Path

    @property
    def manifest(self) -> Path:
        return self.base / "manifest.json"

    @property
    def corpus(self) -> Path:
        return self.base / "corpus"

    @property
    def gold(self) -> Path:
        return self.base / "gold"

    @property
    def sheets(self) -> Path:
        return self.base / "sheets"

    @property
    def runs(self) -> Path:
        return self.base / "runs"

    def new_run(self, label: str | None = None, now: datetime | None = None) -> Path:
        """A fresh run folder named by UTC time, `20261016T093005Z[-label]`. Never reuses one.

        `now` is converted to UTC, and a naive time is taken as UTC already. A label is letters,
        digits, dot, dash or underscore, so it cannot nest the folder.
        """
        if label is not None and not _LABEL.fullmatch(label):
            raise RunLabelError(f"run label {label!r}: use letters, digits, dot, dash or underscore")
        stamp = to_utc(now).strftime("%Y%m%dT%H%M%SZ")
        path = self.runs / (f"{stamp}-{label}" if label else stamp)
        path.mkdir(parents=True, exist_ok=False)
        return path

    def resolve_run(self, name_or_path: str) -> Path:
        """`latest`, the name of a run folder inside `runs/`, or a path to a run folder.

        A bare name is looked up under `runs/` only. A path is absolute or has a folder part
        (`archive/20261016T093005Z`), and may point anywhere. Anything else is a `RunNotFoundError`.
        """
        if name_or_path == "latest":
            found = self.runs.glob("*") if self.runs.is_dir() else ()
            runs = sorted(p for p in found if _RUN_NAME.fullmatch(p.name) and p.is_dir())
            if not runs:
                raise RunNotFoundError(f"no runs under {self.runs}")
            return runs[-1]
        if name_or_path:
            candidate = self.runs / name_or_path
            # Resolved before its parent is taken: `runs/..` is a folder whose parent, as written, is `runs`.
            if candidate.is_dir() and candidate.resolve().parent == self.runs.resolve():
                return candidate
            given = Path(name_or_path)
            # A folder of the same name in the current folder cannot answer for a bare name. A path must also
            # end in a real name: `archive/..` and `/` are folders, but not runs.
            is_path = given.is_absolute() or len(given.parts) > 1
            if is_path and given.name not in ("", "..") and given.is_dir():
                return given
        raise RunNotFoundError(f"no run {name_or_path!r} under {self.runs}")


DEFAULT = EvalPaths(ROOT / "data" / "eval")
