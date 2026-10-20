"""The one base of every error the harness turns into a message.

The command line catches an `EvalError` (and an `OSError`) in one place, shows its text in red and stops with exit
code 1. So the text of an `EvalError` reaches the console: it names a path, a filing id, a sheet row, a column or a
count, and never the label or the figure of a filing."""


class EvalError(Exception):
    """A failure the command line shows as one line, with exit code 1."""
