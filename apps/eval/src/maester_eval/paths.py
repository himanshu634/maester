"""Where the harness reads and writes: its own files under the repository's data/eval, the taxonomy under packages/contracts."""

from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path

# apps/eval/src/maester_eval/paths.py → the repository root. `parents[4]` holds for a checkout
# or an editable install; the harness is never installed as a wheel elsewhere.
ROOT = Path(__file__).resolve().parents[4]
CONCEPTS_PATH = ROOT / "packages" / "contracts" / "concepts.json"


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
        """A fresh run folder named by UTC time, `20261016T093005Z[-label]`. Never reuses one."""
        stamp = (now or datetime.now(timezone.utc)).strftime("%Y%m%dT%H%M%SZ")
        path = self.runs / (f"{stamp}-{label}" if label else stamp)
        path.mkdir(parents=True, exist_ok=False)
        return path

    def resolve_run(self, name_or_path: str) -> Path:
        """`latest`, a run folder's name, or a path to one."""
        if name_or_path == "latest":
            runs = sorted(p for p in self.runs.glob("*") if p.is_dir()) if self.runs.is_dir() else []
            if not runs:
                raise FileNotFoundError(f"no runs under {self.runs}")
            return runs[-1]
        candidate = self.runs / name_or_path
        if candidate.is_dir():
            return candidate
        given = Path(name_or_path)
        if given.is_dir():
            return given
        raise FileNotFoundError(f"no run {name_or_path!r} under {self.runs}")


DEFAULT = EvalPaths(ROOT / "data" / "eval")
