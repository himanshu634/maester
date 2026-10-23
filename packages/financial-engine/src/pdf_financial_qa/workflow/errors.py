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


def is_transient(exc: BaseException) -> bool:
    """Whether a failed model call is worth retrying."""
    if isinstance(exc, ExtractionError):
        return False
    if isinstance(exc, (ModelOutputError, TimeoutError, ConnectionError)):
        return True
    try:
        import anthropic

        if isinstance(exc, (anthropic.APIConnectionError, anthropic.RateLimitError)):  # timeouts are connection errors
            return True
        if isinstance(exc, anthropic.APIStatusError):
            return exc.status_code >= 500  # 529 (overloaded) included
    except ImportError:  # pragma: no cover - anthropic is a declared dependency
        pass
    return False
