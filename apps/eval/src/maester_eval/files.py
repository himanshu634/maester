"""Writing a file so that whoever reads it finds the old text or the new, never a part of either.

`live` can stop at any moment, and a sheet or a gold file is a person's work: a write that stops half-way
must not leave a torn file where a whole one was."""

import json
import os
from pathlib import Path
import secrets
from typing import TypeVar

from pydantic import BaseModel, ValidationError

from maester_eval.errors import EvalError

Model = TypeVar("Model", bound=BaseModel)


class WriteError(EvalError):
    """A file the harness could not write. It names the file it meant to write, never the temporary one beside it."""


def write_text_atomically(path: Path, text: str, encoding: str = "utf-8") -> None:
    """Write `text` to `path` in one step: into a new file beside it, which then takes its place (`os.replace`).

    The new file is `.<name>.<random>.tmp` in the same folder. It never ends in `.json`, so no reader takes it for
    an artefact or a gold file, and a write that fails removes it. The text is written as given, with no newline
    translation, so a CSV keeps the `\\r\\n` its writer chose. The folder is made if it does not exist.

    A write the system refuses (no folder, no permission, a full disk) is a `WriteError`:
    `cannot write <path>: <reason>`."""
    write_bytes_atomically(path, text.encode(encoding))


def write_bytes_atomically(path: Path, data: bytes) -> None:
    """`write_text_atomically` for bytes: an XBRL instance copied into the corpus is written the same way."""
    temporary = path.with_name(f".{path.name}.{secrets.token_hex(4)}.tmp")
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        handle = temporary.open("xb")
        try:
            with handle:
                handle.write(data)
                handle.flush()
                os.fsync(handle.fileno())
            os.replace(temporary, path)
        except BaseException:
            temporary.unlink(missing_ok=True)
            raise
    except OSError as exc:
        raise WriteError(f"cannot write {path}: {exc.strerror or exc}") from exc


def read_model(path: Path, model: type[Model], error: type[Exception], what: str) -> Model:
    """`path` read as UTF-8 JSON of the form `model`. A file that is not is an `error` saying "<path> is not a readable
    <what>" and nothing more: the text of a JSON or validation error repeats what the file holds, which can be a label
    or a figure of a filing. A file that does not exist is a `FileNotFoundError`."""
    try:
        return model.model_validate(json.loads(path.read_text(encoding="utf-8")))
    except (json.JSONDecodeError, UnicodeDecodeError, ValidationError):
        raise error(f"{path} is not a readable {what}") from None
