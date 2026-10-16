"""Writing a file so that whoever reads it finds the old text or the new, never a part of either.

`live` can stop at any moment, and a sheet or a gold file is a person's work: a write that stops half-way
must not leave a torn file where a whole one was."""

import os
from pathlib import Path
import secrets


def write_text_atomically(path: Path, text: str, encoding: str = "utf-8") -> None:
    """Write `text` to `path` in one step: into a new file beside it, which then takes its place (`os.replace`).

    The new file is `.<name>.<random>.tmp` in the same folder. It never ends in `.json`, so no reader takes it for
    an artefact or a gold file, and a write that fails removes it. The text is written as given, with no newline
    translation, so a CSV keeps the `\\r\\n` its writer chose. The folder is made if it does not exist."""
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(f".{path.name}.{secrets.token_hex(4)}.tmp")
    handle = temporary.open("x", encoding=encoding, newline="")
    try:
        with handle:
            handle.write(text)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary, path)
    except BaseException:
        temporary.unlink(missing_ok=True)
        raise
