"""Build small synthetic PDFs with a real text layer, for offline tests.

Never use real filings in tests; these documents are generated here.
"""


def _escape(text: str) -> str:
    return text.replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)")


def make_pdf(pages: list[list[str]]) -> bytes:
    """A PDF with one Helvetica text line per string. An empty page list has no
    text layer, standing in for a scanned page."""
    count = len(pages)
    page_ids = [4 + 2 * i for i in range(count)]
    content_ids = [5 + 2 * i for i in range(count)]
    objects = {
        1: "<< /Type /Catalog /Pages 2 0 R >>",
        2: f"<< /Type /Pages /Kids [{' '.join(f'{p} 0 R' for p in page_ids)}] /Count {count} >>",
        3: "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    }
    for i, lines in enumerate(pages):
        stream = "BT /F1 10 Tf 14 TL 50 750 Td " + " ".join(f"({_escape(line)}) Tj T*" for line in lines) + " ET"
        objects[content_ids[i]] = f"<< /Length {len(stream.encode('latin-1'))} >>\nstream\n{stream}\nendstream"
        objects[page_ids[i]] = (
            "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] "
            f"/Resources << /Font << /F1 3 0 R >> >> /Contents {content_ids[i]} 0 R >>"
        )
    out = bytearray(b"%PDF-1.4\n")
    offsets = {}
    for number in sorted(objects):
        offsets[number] = len(out)
        out += f"{number} 0 obj\n{objects[number]}\nendobj\n".encode("latin-1")
    xref = len(out)
    size = max(objects) + 1
    out += f"xref\n0 {size}\n0000000000 65535 f \n".encode()
    for number in range(1, size):
        out += f"{offsets[number]:010d} 00000 n \n".encode()
    out += f"trailer\n<< /Size {size} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n".encode()
    return bytes(out)
