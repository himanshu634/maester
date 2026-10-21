"""The OCR spot-check command. No models are loaded: a fake reader and a fake clock stand in."""

import csv
import io
import json
import shutil
import tempfile
import unittest
import weakref
from contextlib import redirect_stderr, redirect_stdout
from datetime import datetime, timedelta, timezone
from pathlib import Path
from threading import Event

from pydantic import ValidationError

from maester_indexer.contracts import RangeRead
from maester_indexer.ocr_sample import (
    CONFIGS,
    DIGITAL_CONFIGS,
    SCORE_COLUMNS,
    DisagreementFile,
    OneReaderAtATime,
    PagesFile,
    disagreements,
    main,
    number_tokens,
    run_sample,
)
from maester_indexer.settings import Settings
from tests.helpers import FIXTURES, fixture_read

CONTRACT_FIXTURES = Path(__file__).resolve().parents[3] / "packages" / "contracts" / "fixtures"
PAGE = {"filing": "aether/ar-00", "page": 1}
# The fixture PDF has one page, so each of the 15 pages is page 1 of a filing of its own.
FILINGS = [f"aether/ar-{n:02d}" for n in range(15)]
EXTRA_NUMBER = "9,999"
WHEN = datetime(2026, 10, 21, 4, 0, 5, tzinfo=timezone.utc)


def fake_read(page: int, extra: str = "") -> RangeRead:
    """The saved read of scanned.pdf, as if it had been the read of `page`, with `extra` added to its text."""
    read = fixture_read("scanned")
    only = read.pages[0]
    text = f"{only.text} {extra}" if extra else only.text
    return read.model_copy(
        update={"first_page": page, "last_page": page, "pages": [only.model_copy(update={"page_number": page, "text": text})]}
    )


def pages_data(scanned: int = 10, digital: int = 5) -> dict:
    refs = [{"filing": filing, "page": 1} for filing in FILINGS]
    return {"scanned": refs[:scanned], "digital": refs[scanned : scanned + digital]}


def pages(scanned: int = 10, digital: int = 5) -> PagesFile:
    return PagesFile.model_validate(pages_data(scanned, digital))


class SampleTestCase(unittest.TestCase):
    def setUp(self):
        folder = tempfile.TemporaryDirectory()
        self.addCleanup(folder.cleanup)
        self.root = Path(folder.name)
        self.corpus = self.root / "corpus"
        for filing in FILINGS:
            target = self.corpus / f"{filing}.pdf"
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy(FIXTURES / "scanned.pdf", target)
        self.out = self.root / "runs"

    def pages_file(self, scanned: int = 10, digital: int = 5) -> Path:
        path = self.root / "pages.json"
        path.write_text(json.dumps(pages_data(scanned, digital)), encoding="utf-8")
        return path

    def rows(self, run: Path) -> list[dict]:
        with (run / "scores.csv").open(encoding="utf-8", newline="") as handle:
            return list(csv.DictReader(handle))

    def entries(self, run: Path) -> list:
        return DisagreementFile.model_validate_json((run / "disagreements.json").read_text(encoding="utf-8")).root


class TokenTests(unittest.TestCase):
    def test_number_tokens_keep_the_printed_form(self):
        self.assertEqual(number_tokens("Revenue 1,23,456.78 and (4,567) less -12"), ["1,23,456.78", "(4,567)", "-12"])

    def test_disagreements(self):
        self.assertEqual(disagreements(["1,200", "(45)", "300"], ["1,200", "45", "300", "7"]), [("(45)", "45"), ("", "7")])

    def test_two_tokens_read_as_one_are_one_disagreement(self):
        self.assertEqual(disagreements(["1,200", "300"], ["1,200300"]), [("1,200 300", "1,200300")])

    def test_the_same_tokens_do_not_disagree(self):
        self.assertEqual(disagreements(["1", "2"], ["1", "2"]), [])


class SharedFixtureTests(unittest.TestCase):
    def test_the_shared_disagreements_fixture_round_trips(self):
        data = json.loads(CONTRACT_FIXTURES.joinpath("eval", "ocr-disagreements.json").read_text(encoding="utf-8"))
        self.assertEqual(DisagreementFile.model_validate(data).model_dump(mode="json"), data)


class PagesFileTests(unittest.TestCase):
    def test_pages_file_needs_ten_scanned_and_five_digital_pages(self):
        with self.assertRaises(ValidationError):
            PagesFile.model_validate({"scanned": [PAGE] * 9, "digital": [PAGE] * 5})
        with self.assertRaises(ValidationError):
            PagesFile.model_validate({"scanned": [PAGE] * 10, "digital": [PAGE] * 4})
        with self.assertRaises(ValidationError):
            PagesFile.model_validate({"scanned": [PAGE] * 11, "digital": [PAGE] * 5})

    def test_a_page_is_counted_from_one(self):
        with self.assertRaises(ValidationError):
            PagesFile.model_validate({"scanned": [{**PAGE, "page": 0}] * 10, "digital": [PAGE] * 5})

    def test_unknown_fields_are_refused(self):
        with self.assertRaises(ValidationError):
            PagesFile.model_validate({**pages_data(), "extra": []})

    def test_the_configurations(self):
        self.assertEqual(
            CONFIGS,
            {
                "rapidocr-cm": ("rapidocr", True),
                "rapidocr-nocm": ("rapidocr", False),
                "tesseract-cm": ("tesseract", True),
                "tesseract-nocm": ("tesseract", False),
            },
        )
        self.assertEqual(DIGITAL_CONFIGS, ("rapidocr-cm", "rapidocr-nocm"))


class RunSampleTests(SampleTestCase):
    def test_run_sample_reads_each_page_under_its_configs_and_times_without_the_warm_up(self):
        ticks = iter(range(0, 1000, 2))  # each read takes 2.0 s on the fake clock
        calls = []

        def read(pdf, page, config):
            calls.append((page, config))
            return fake_read(page)

        run = run_sample(pages(scanned=10, digital=5), self.corpus, self.out, read, clock=lambda: float(next(ticks)))
        rows = self.rows(run)
        self.assertEqual(len(rows), 10 * 4 + 5 * 2)
        self.assertEqual(len(calls), 4 + 10 * 4 + 5 * 2)  # one warm-up per config, untimed
        configs_in_order = [c for _, c in calls]
        self.assertEqual(configs_in_order, sorted(configs_in_order, key=list(CONFIGS).index))  # config by config, never interleaved
        self.assertEqual({r["seconds"] for r in rows}, {"2.0"})
        self.assertEqual({r["config"] for r in rows if r["kind"] == "digital"}, {"rapidocr-cm", "rapidocr-nocm"})
        self.assertEqual({r["numbers_printed"] for r in rows} | {r["numbers_extra"] for r in rows} | {r["checked"] for r in rows}, {""})

    def test_each_config_warms_up_on_the_first_scanned_page_before_its_timed_reads(self):
        marker = b"\n% first scanned page\n"  # after %%EOF, so pdfium still reads the file
        first_pdf = self.corpus / f"{FILINGS[0]}.pdf"
        first_pdf.write_bytes(first_pdf.read_bytes() + marker)
        calls = []

        def read(pdf, page, config):
            calls.append((pdf.endswith(marker), config))
            return fake_read(page)

        run_sample(pages(), self.corpus, self.out, read)
        for config in CONFIGS:
            made = [first for first, c in calls if c == config]
            timed = 10 + (5 if config in DIGITAL_CONFIGS else 0)
            self.assertEqual(len(made), 1 + timed, config)
            self.assertEqual(made[:2], [True, True], config)  # the warm-up, then the first timed page
            self.assertFalse(any(made[2:]), config)

    def test_the_sheet_has_the_columns_and_one_row_per_page_and_config_page_by_page(self):
        run = run_sample(pages(), self.corpus, self.out, lambda pdf, page, config: fake_read(page))
        with (run / "scores.csv").open(encoding="utf-8", newline="") as handle:
            self.assertEqual(next(csv.reader(handle)), SCORE_COLUMNS)
        rows = self.rows(run)
        self.assertEqual([(r["filing"], r["config"]) for r in rows[:4]], [(FILINGS[0], config) for config in CONFIGS])
        self.assertEqual([(r["filing"], r["config"]) for r in rows[-2:]], [(FILINGS[14], "rapidocr-cm"), (FILINGS[14], "rapidocr-nocm")])
        first = rows[2]
        self.assertEqual(
            (first["page"], first["kind"], first["config"], first["engine"], first["cell_matching"]),
            ("1", "scanned", "tesseract-cm", "tesseract", "true"),
        )
        self.assertEqual(rows[3]["cell_matching"], "false")
        self.assertEqual(rows[-1]["kind"], "digital")
        counts = [name for name in SCORE_COLUMNS if name.endswith(("_printed", "_wrong", "_missing", "_extra"))] + ["checked"]
        self.assertEqual({value for row in rows for name, value in row.items() if name in counts}, {""})

    def test_the_run_folder_is_named_by_utc_time(self):
        ist = timezone(timedelta(hours=5, minutes=30))
        run = run_sample(
            pages(), self.corpus, self.out, lambda pdf, page, config: fake_read(page), now=lambda: datetime(2026, 10, 21, 9, 30, 5, tzinfo=ist)
        )
        self.assertEqual(run.name, "20261021T040005Z")
        self.assertEqual(run.parent, self.out)
        self.entries(run)

    def test_a_time_without_a_zone_is_taken_as_utc(self):
        run = run_sample(
            pages(), self.corpus, self.out, lambda pdf, page, config: fake_read(page), now=lambda: datetime(2026, 10, 21, 4, 0, 5)
        )
        self.assertEqual(run.name, "20261021T040005Z")

    def test_a_folder_that_exists_is_refused_and_left_alone(self):
        (self.out / "20261021T040005Z").mkdir(parents=True)
        (self.out / "20261021T040005Z" / "kept.txt").write_text("kept", encoding="utf-8")
        calls = []

        def read(pdf, page, config):
            calls.append(config)
            return fake_read(page)

        with self.assertRaises(FileExistsError):
            run_sample(pages(), self.corpus, self.out, read, now=lambda: WHEN)
        self.assertEqual(calls, [])
        self.assertEqual([p.name for p in (self.out / "20261021T040005Z").iterdir()], ["kept.txt"])

    def test_a_missing_pdf_stops_the_run_before_anything_is_read(self):
        (self.corpus / f"{FILINGS[12]}.pdf").unlink()
        calls = []

        def read(pdf, page, config):
            calls.append(config)
            return fake_read(page)

        with self.assertRaises(FileNotFoundError) as caught:
            run_sample(pages(), self.corpus, self.out, read, now=lambda: WHEN)
        self.assertIn(FILINGS[12], str(caught.exception))
        self.assertEqual(calls, [])
        self.assertFalse(self.out.exists())

    def test_each_read_leaves_its_files_under_the_filing_slug(self):
        run = run_sample(pages(), self.corpus, self.out, lambda pdf, page, config: fake_read(page), clock=iter([0.0, 3.25] * 100).__next__)
        names = {p.name for p in run.iterdir()}
        self.assertEqual(len(names), 50 + 15 + 15 + 2)  # reads, images, sheets for the person, disagreements.json and scores.csv
        for name in (
            "aether--ar-00_p1_rapidocr-cm.json",
            "aether--ar-00_p1_tesseract-nocm.json",
            "aether--ar-00_p1.png",
            "aether--ar-00_p1.md",
            "aether--ar-14_p1_rapidocr-nocm.json",
            "disagreements.json",
            "scores.csv",
        ):
            self.assertIn(name, names)
        self.assertNotIn("aether--ar-14_p1_tesseract-cm.json", names)  # a digital page is not read by Tesseract
        wire = json.loads((run / "aether--ar-00_p1_rapidocr-cm.json").read_text(encoding="utf-8"))
        self.assertEqual((wire["seconds"], wire["ocrEngine"]), (3.25, "rapidocr-onnxruntime 3.9.2"))
        read = RangeRead.from_wire({k: v for k, v in wire.items() if k not in ("seconds", "ocrEngine")})
        self.assertEqual((read.first_page, read.last_page), (1, 1))
        self.assertEqual((run / "aether--ar-00_p1.png").read_bytes()[:8], b"\x89PNG\r\n\x1a\n")

    def test_the_engine_string_is_the_one_the_read_names(self):
        def read(pdf, page, config):
            fake = fake_read(page)
            engine = "tesseract-cli 5.5.3 eng:0123456789ab" if config.startswith("tesseract") else fake.versions.ocr_engine
            return fake.model_copy(update={"versions": fake.versions.model_copy(update={"ocr_engine": engine})})

        run = run_sample(pages(), self.corpus, self.out, read)
        engines = {}
        for path in run.glob("*_p1_*.json"):
            config = path.stem.rsplit("_", 1)[1]
            engines.setdefault(config, set()).add(json.loads(path.read_text(encoding="utf-8"))["ocrEngine"])
        self.assertEqual(
            engines,
            {
                "rapidocr-cm": {"rapidocr-onnxruntime 3.9.2"},
                "rapidocr-nocm": {"rapidocr-onnxruntime 3.9.2"},
                "tesseract-cm": {"tesseract-cli 5.5.3 eng:0123456789ab"},
                "tesseract-nocm": {"tesseract-cli 5.5.3 eng:0123456789ab"},
            },
        )


class DisagreementTests(SampleTestCase):
    def read_with_an_extra_number_under_tesseract_cm(self, pdf, page, config):
        return fake_read(page, extra=EXTRA_NUMBER if config == "tesseract-cm" else "")

    def test_configs_that_read_the_same_numbers_leave_no_entry(self):
        run = run_sample(pages(), self.corpus, self.out, lambda pdf, page, config: fake_read(page))
        self.assertEqual(self.entries(run), [])

    def test_a_pair_that_differs_is_one_entry_with_a_before_b_in_config_order(self):
        run = run_sample(pages(), self.corpus, self.out, self.read_with_an_extra_number_under_tesseract_cm)
        entries = self.entries(run)
        scanned = [entry for entry in entries if entry.filing == FILINGS[0]]
        self.assertEqual(
            [(e.filing, e.page, e.a, e.b, e.pairs) for e in scanned],
            [
                (FILINGS[0], 1, "rapidocr-cm", "tesseract-cm", [("", EXTRA_NUMBER)]),
                (FILINGS[0], 1, "rapidocr-nocm", "tesseract-cm", [("", EXTRA_NUMBER)]),
                (FILINGS[0], 1, "tesseract-cm", "tesseract-nocm", [(EXTRA_NUMBER, "")]),
            ],
        )
        self.assertEqual(len(entries), 10 * 3)  # the five digital pages are not read by Tesseract
        self.assertEqual([e.filing for e in entries], [f for f in FILINGS[:10] for _ in range(3)])  # in the pages file's order

    def test_the_sheet_for_the_person_shows_the_text_the_tables_and_the_disagreements(self):
        run = run_sample(pages(), self.corpus, self.out, self.read_with_an_extra_number_under_tesseract_cm)
        sheet = (run / "aether--ar-00_p1.md").read_text(encoding="utf-8")
        for config in CONFIGS:
            self.assertIn(f"## {config}", sheet)
        self.assertIn("Revenue from operations 21 1,23,456.78 1,08,642.10", sheet)  # the page text
        self.assertIn("| ", sheet)  # a table, as markdown
        self.assertIn(f"(none) → {EXTRA_NUMBER}", sheet)
        self.assertIn(f"{EXTRA_NUMBER} → (none)", sheet)
        self.assertIn("aether--ar-00_p1.png", sheet)
        digital = (run / "aether--ar-10_p1.md").read_text(encoding="utf-8")
        self.assertNotIn("tesseract", digital)

    def test_a_page_with_no_text_says_why(self):
        def read(pdf, page, config):
            fake = fake_read(page)
            empty = fake.pages[0].model_copy(update={"text": "", "none_reason": "OCR_FAILED"})
            return fake.model_copy(update={"pages": [empty]})

        run = run_sample(pages(), self.corpus, self.out, read)
        self.assertIn("OCR_FAILED", (run / "aether--ar-00_p1.md").read_text(encoding="utf-8"))
        self.assertEqual(self.entries(run), [])


class MainTests(SampleTestCase):
    def test_main_prints_the_run_and_counts_only(self):
        with redirect_stdout(io.StringIO()) as buf:
            code = main(
                ["--pages", str(self.pages_file()), "--corpus", str(self.corpus), "--out", str(self.out)],
                read=lambda pdf, page, config: fake_read(page),
                now=lambda: WHEN,
            )
        self.assertEqual(code, 0)
        self.assertEqual(buf.getvalue().splitlines(), ["run 20261021T040005Z: 15 pages, 50 page reads"])

    def test_main_names_a_folder_that_exists_and_a_missing_pdf_without_a_traceback(self):
        (self.out / "20261021T040005Z").mkdir(parents=True)
        args = ["--pages", str(self.pages_file()), "--corpus", str(self.corpus), "--out", str(self.out)]
        with redirect_stdout(io.StringIO()) as out, redirect_stderr(io.StringIO()) as err:
            code = main(args, read=lambda pdf, page, config: fake_read(page), now=lambda: WHEN)
        self.assertEqual((code, out.getvalue()), (1, ""))
        self.assertIn("20261021T040005Z", err.getvalue())
        (self.corpus / f"{FILINGS[3]}.pdf").unlink()
        with redirect_stdout(io.StringIO()) as out, redirect_stderr(io.StringIO()) as err:
            code = main(args, read=lambda pdf, page, config: fake_read(page), now=lambda: WHEN + timedelta(seconds=1))
        self.assertEqual((code, out.getvalue()), (1, ""))
        self.assertIn(FILINGS[3], err.getvalue())

    def test_main_refuses_a_pages_file_that_is_not_ten_and_five_pages(self):
        with redirect_stdout(io.StringIO()) as out, redirect_stderr(io.StringIO()) as err:
            code = main(
                ["--pages", str(self.pages_file(scanned=9, digital=6)), "--corpus", str(self.corpus), "--out", str(self.out)],
                read=lambda pdf, page, config: self.fail("nothing is read"),
            )
        self.assertEqual((code, out.getvalue()), (1, ""))
        self.assertIn("scanned", err.getvalue())
        self.assertFalse(self.out.exists())


class OneReaderAtATimeTests(unittest.TestCase):
    class FakeReader:
        def __init__(self, settings: Settings) -> None:
            self.settings = settings
            self.calls: list[tuple[int, int, int]] = []

        def read_range(self, pdf: bytes, first: int, last: int, ocr_pages_left: int, cancel: Event) -> RangeRead:
            self.calls.append((first, last, ocr_pages_left))
            assert not cancel.is_set()
            return fake_read(first)

    def setUp(self):
        self.built: list[weakref.ref] = []
        self.settings_seen: list[tuple[str, bool]] = []

        def make(settings: Settings):
            reader = self.FakeReader(settings)
            self.built.append(weakref.ref(reader))
            self.settings_seen.append((settings.ocr_engine, settings.table_cell_matching))
            return reader

        self.read = OneReaderAtATime(make, lambda: Settings(threads=3))

    def test_a_config_builds_its_reader_once_with_its_engine_and_cell_matching(self):
        self.read(b"%PDF", 7, "tesseract-nocm")
        self.read(b"%PDF", 8, "tesseract-nocm")
        self.assertEqual(self.settings_seen, [("tesseract", False)])
        self.assertEqual(self.built[0]().calls, [(7, 7, 1), (8, 8, 1)])  # one page, OCR allowed
        self.assertEqual(self.built[0]().settings.threads, 3)  # the rest of the settings are the environment's

    def test_a_new_config_drops_the_old_reader_before_the_next_is_built(self):
        for config in CONFIGS:
            self.read(b"%PDF", 1, config)
            live = [ref for ref in self.built if ref() is not None]
            self.assertEqual(len(live), 1)
        self.assertEqual(self.settings_seen, [CONFIGS[config] for config in CONFIGS])

    def test_the_old_reader_is_gone_when_the_next_is_built(self):
        gone_at_build = []

        def make(settings: Settings):
            gone_at_build.append([ref() is None for ref in self.built])
            reader = self.FakeReader(settings)
            self.built.append(weakref.ref(reader))
            return reader

        read = OneReaderAtATime(make, Settings)
        read(b"%PDF", 1, "rapidocr-cm")
        read(b"%PDF", 1, "rapidocr-nocm")
        read(b"%PDF", 1, "tesseract-cm")
        self.assertEqual(gone_at_build, [[], [True], [True, True]])


if __name__ == "__main__":
    unittest.main()
