"""Errors the extraction workflow raises and how transient failures are recognised."""


class ExtractionError(Exception):
    """A failure reported to the caller with a stable code.

    ``retryable`` tells the job system whether running the same request again
    can succeed (a model outage) or cannot (an unreadable PDF).
    """

    def __init__(self, code: str, message: str, *, retryable: bool) -> None:
        super().__init__(message)
        self.code = code
        self.message = message
        self.retryable = retryable


class ModelOutputError(Exception):
    """The model answered, but not with something usable (e.g. a page outside the file)."""


class PermanentModelError(Exception):
    """The model answered in a way a retry would repeat: it refused, or its answer was cut off.

    It fails the one call, not the run, so a statement branch or a correction can fail on its own;
    it becomes a permanent ``ExtractionError`` with the same code only if it ends the run.
    """

    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code
        self.message = message


def is_transient(exc: BaseException) -> bool:
    """Whether a failed model call is worth retrying."""
    if isinstance(exc, (ExtractionError, PermanentModelError)):
        return False
    if isinstance(exc, (ModelOutputError, TimeoutError, ConnectionError)):
        return True
    import anthropic

    if isinstance(exc, (anthropic.APIConnectionError, anthropic.RateLimitError)):  # timeouts are connection errors
        return True
    if isinstance(exc, anthropic.APIStatusError):
        return exc.status_code >= 500  # 529 (overloaded) included
    return False
