"""Check package boundaries, syntax, and local Markdown links without network access."""

import ast
from pathlib import Path
import re
import sys
import tomllib
from urllib.parse import unquote, urlsplit

ROOT = Path(__file__).resolve().parents[1]
IGNORED_PARTS = {"node_modules", ".svelte-kit", "build", "dist"}


def _tracked(path: Path) -> bool:
    """Skip generated and vendored trees (Node dependencies, build output)."""
    return not IGNORED_PARTS.intersection(path.relative_to(ROOT).parts)


def main() -> int:
    errors: list[str] = []
    config = tomllib.loads((ROOT / "pyproject.toml").read_text())
    members = config["tool"]["uv"]["workspace"]["members"]
    names: set[str] = set()
    for member in members:
        manifest = ROOT / member / "pyproject.toml"
        if not manifest.is_file():
            errors.append(f"Missing member manifest: {member}")
            continue
        metadata = tomllib.loads(manifest.read_text())
        name = metadata["project"]["name"]
        if name in names:
            errors.append(f"Duplicate package name: {name}")
        names.add(name)
        if not list((ROOT / member / "src").rglob("*.py")):
            errors.append(f"Workspace member has no Python source: {member}")
    for name, source in config["tool"]["uv"]["sources"].items():
        if source.get("workspace") and name not in names:
            errors.append(f"Workspace dependency has no member: {name}")

    python_files = []
    for folder in ("apps", "packages", "tests", "scripts"):
        python_files.extend(p for p in (ROOT / folder).rglob("*.py") if _tracked(p))
    for path in python_files:
        try:
            tree = ast.parse(path.read_text(), filename=str(path))
        except SyntaxError as exc:
            errors.append(f"Syntax error in {path.relative_to(ROOT)}: {exc.msg}")
            continue
        if path.is_relative_to(ROOT / "packages"):
            for node in ast.walk(tree):
                imports = []
                if isinstance(node, ast.Import):
                    imports = [alias.name for alias in node.names]
                elif isinstance(node, ast.ImportFrom) and node.module:
                    imports = [node.module]
                if any(name.split(".")[0] in {"maester_cli", "apps"} for name in imports):
                    errors.append(f"Library imports an application: {path.relative_to(ROOT)}")

    markdown_files = [ROOT / "README.md"]
    for folder in ("docs", "apps", "packages"):
        markdown_files.extend(p for p in (ROOT / folder).rglob("*.md") if _tracked(p))
    for path in markdown_files:
        content = re.sub(r"```.*?```", "", path.read_text(), flags=re.DOTALL)
        for target in re.findall(r"\[[^\]\n]+\]\(([^)\n]+)\)", content):
            target = target.strip().removeprefix("<").removesuffix(">")
            parsed = urlsplit(target)
            if parsed.scheme or parsed.netloc or not parsed.path:
                continue
            linked = (path.parent / unquote(parsed.path)).resolve()
            if not linked.exists():
                errors.append(f"Broken local link in {path.relative_to(ROOT)}: {target}")

    if errors:
        print("\n".join(errors), file=sys.stderr)
        return 1
    print(f"Workspace OK: {len(members)} members, {len(python_files)} Python files, "
          f"{len(markdown_files)} Markdown files checked.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
