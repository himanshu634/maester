"""The error the indexer reports to the worker."""


class IndexingError(Exception):
    """A failure with a code from spec section 15 and whether the worker should try again.

    The message never holds document text: no page or chunk text, heading or query."""

    def __init__(self, code: str, message: str, retryable: bool) -> None:
        super().__init__(f"{code}: {message}")
        self.code = code
        self.message = message
        self.retryable = retryable
