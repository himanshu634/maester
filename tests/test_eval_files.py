"""The atomic write behind every file the harness keeps: artefacts, run.json, sheets and gold files. Offline."""

import json
from pathlib import Path
import tempfile
import unittest
from unittest import mock

from eval_fixtures import FILING, WHEN, scored_row
from test_extraction_workflow import FAST, PDF, ScriptedModel

from maester_eval import files
from maester_eval.artefacts import artefact_path, read_artefacts, read_run, write_artefact, write_run
from maester_eval.concepts import load_taxonomy
from maester_eval.files import write_text_atomically
from maester_eval.gold import freeze_sheet, gold_path, read_gold, write_gold
from maester_eval.runner import run_filing
from maester_eval.sheets import sheet_rows, write_sheet


class Interrupted(Exception):
    """A write stopped half-way, as a full disk or a stopped process stops it."""


class WriteTextAtomicallyTests(unittest.TestCase):
    def setUp(self):
        temp = tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        self.folder = Path(temp.name)
        self.path = self.folder / "nested" / "run.json"  # the folder does not exist yet

    def stray(self):
        return [p.name for p in self.path.parent.iterdir() if p != self.path]

    def test_writes_the_text_as_given_and_makes_the_folder(self):
        write_text_atomically(self.path, "line one\r\nline two\n₹\n")
        self.assertEqual(self.path.read_bytes(), "line one\r\nline two\n₹\n".encode("utf-8"))  # no newline translation
        write_text_atomically(self.path, "ab", encoding="utf-8-sig")
        self.assertEqual(self.path.read_bytes(), b"\xef\xbb\xbfab")  # one BOM, at the start
        self.assertEqual(self.stray(), [])

    def test_a_write_that_fails_leaves_the_old_file_and_nothing_beside_it(self):
        write_text_atomically(self.path, "the old text")
        with self.assertRaises(UnicodeEncodeError):
            write_text_atomically(self.path, "₹ 2,000", encoding="ascii")  # fails half-way through the new file
        with mock.patch.object(files.os, "replace", side_effect=Interrupted), self.assertRaises(Interrupted):
            write_text_atomically(self.path, "the new text")
        with mock.patch.object(files.os, "fsync", side_effect=KeyboardInterrupt), self.assertRaises(KeyboardInterrupt):
            write_text_atomically(self.path, "the new text")
        self.assertEqual(self.path.read_text(encoding="utf-8"), "the old text")
        self.assertEqual(self.stray(), [])

    def test_the_new_file_is_a_hidden_tmp_file_beside_the_old_one(self):
        seen = []

        def stop(source, target):
            seen.append((Path(source), Path(target)))
            raise Interrupted

        with mock.patch.object(files.os, "replace", side_effect=stop), self.assertRaises(Interrupted):
            write_text_atomically(self.path, "text")
        ((source, target),) = seen
        self.assertEqual((source.parent, target), (self.path.parent, self.path))
        self.assertTrue(source.name.startswith(".run.json."), source.name)
        self.assertTrue(source.name.endswith(".tmp"), source.name)  # never `.json`: no reader picks it up
        self.assertFalse(source.exists())


class WritersAreAtomicTests(unittest.TestCase):
    """Each file the harness keeps is replaced in one step: a write that stops leaves the file as it was."""

    def setUp(self):
        temp = tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        self.folder = Path(temp.name)
        self.artefact = run_filing(FILING, PDF, lambda: ScriptedModel(), FAST)

    def assert_kept_when_the_write_stops(self, path, write):
        before = path.read_bytes()
        with mock.patch.object(files.os, "replace", side_effect=Interrupted), self.assertRaises(Interrupted):
            write()
        self.assertEqual(path.read_bytes(), before)
        self.assertEqual([p.name for p in path.parent.iterdir()], [path.name])

    def test_an_artefact(self):
        path = write_artefact(self.folder, self.artefact)
        self.assert_kept_when_the_write_stops(path, lambda: write_artefact(self.folder, self.artefact))
        self.assertEqual(read_artefacts(self.folder), [self.artefact])

    def test_run_json(self):
        write_run(self.folder, {"run": "r", "set": "dev"})
        self.assert_kept_when_the_write_stops(self.folder / "run.json", lambda: write_run(self.folder, {"run": "s"}))
        self.assertEqual(read_run(self.folder), {"run": "r", "set": "dev"})

    def test_a_sheet(self):
        path = self.folder / "sheets" / f"{FILING.id}.csv"
        write_sheet(path, sheet_rows(self.artefact))
        self.assert_kept_when_the_write_stops(path, lambda: write_sheet(path, []))

    def test_a_gold_file(self):
        gold = freeze_sheet([scored_row()], FILING, load_taxonomy(), WHEN)
        path = write_gold(self.folder, gold)
        self.assert_kept_when_the_write_stops(path, lambda: write_gold(self.folder, gold, force=True))
        self.assertEqual(read_gold(self.folder), {FILING.id: gold})
        self.assertEqual(path, gold_path(self.folder, FILING.id))

    def test_a_file_left_by_a_write_that_was_killed_is_read_by_no_one(self):
        # A process killed between the two steps leaves its `.tmp` file; the readers take `*.json` only.
        write_artefact(self.folder, self.artefact)
        gold_dir = self.folder / "gold"
        write_gold(gold_dir, freeze_sheet([scored_row()], FILING, load_taxonomy(), WHEN))
        for path in (artefact_path(self.folder, "other/ar-2025-26"), gold_path(gold_dir, "other/ar-2025-26")):
            leftover = path.with_name(f".{path.name}.0a1b2c3d.tmp")
            leftover.parent.mkdir(parents=True, exist_ok=True)
            leftover.write_text("{\"filing_id\": ", encoding="utf-8")
        self.assertEqual([a.filing_id for a in read_artefacts(self.folder)], [FILING.id])
        self.assertEqual(list(read_gold(gold_dir)), [FILING.id])
        self.assertEqual(json.loads(artefact_path(self.folder, FILING.id).read_text(encoding="utf-8"))["filing_id"], FILING.id)


if __name__ == "__main__":
    unittest.main()
