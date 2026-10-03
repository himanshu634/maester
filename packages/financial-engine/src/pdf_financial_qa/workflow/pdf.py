"""PDF access for the workflow: page count, text layer and page subsets."""

import io
import logging
import threading
from dataclasses import dataclass, field

from pypdf import PdfReader, PdfWriter

from pdf_financial_qa.workflow.errors import ExtractionError

logging.getLogger("pypdf").setLevel(logging.ERROR)


@dataclass
class PdfDocument:
    data: bytes
    reader: PdfReader
    page_texts: list[str]
    # pypdf readers are not thread-safe; statement branches subset pages in parallel.
    _lock: threading.Lock = field(default_factory=threading.Lock, repr=False, compare=False)

    @property
    def page_count(self) -> int:
        return len(self.page_texts)

    @classmethod
    def load(cls, data: bytes) -> "PdfDocument":
        try:
            reader = PdfReader(io.BytesIO(data))
            if reader.is_encrypted and not reader.decrypt(""):
                raise ExtractionError("UNREADABLE_PDF", "the PDF is encrypted", retryable=False)
            pages = list(reader.pages)
        except ExtractionError:
            raise
        except Exception as exc:  # pypdf raises a variety of errors for malformed files
            raise ExtractionError("UNREADABLE_PDF", f"the PDF could not be read: {type(exc).__name__}", retryable=False) from exc
        if not pages:
            raise ExtractionError("UNREADABLE_PDF", "the PDF has no pages", retryable=False)
        texts = []
        for page in pages:
            try:
                texts.append(page.extract_text() or "")
            except Exception:  # a page whose text layer cannot be read is treated as a scan
                texts.append("")
        return cls(data=data, reader=reader, page_texts=texts)

    def subset(self, page_indexes: list[int]) -> bytes:
        """A new PDF holding only the given 0-based pages, in the given order."""
        with self._lock:
            writer = PdfWriter()
            for index in page_indexes:
                writer.add_page(self.reader.pages[index])
            buffer = io.BytesIO()
            writer.write(buffer)
            return buffer.getvalue()

    def chunks(self, size: int) -> list[tuple[int, int, bytes]]:
        """Consecutive ``(first_page_index, page_count, pdf_bytes)`` chunks of at most ``size`` pages."""
        out = []
        for start in range(0, self.page_count, size):
            indexes = list(range(start, min(start + size, self.page_count)))
            out.append((start, len(indexes), self.subset(indexes)))
        return out
