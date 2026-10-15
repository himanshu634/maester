"""Where the harness reads and writes. Everything lives under the repository's data/eval."""

from pathlib import Path

# apps/eval/src/maester_eval/paths.py → the repository root.
ROOT = Path(__file__).resolve().parents[4]
CONCEPTS_PATH = ROOT / "packages" / "contracts" / "concepts.json"
