"""Rules first, the model only for open answers, every model answer checked. Offline."""

import unittest
from unittest import mock

from pdf_fixtures import make_pdf

from pdf_financial_qa.classify import ClassifySettings, run_classification
from pdf_financial_qa.classify.model import Answer, ClassifyOutput, GeminiClassificationModel
from pdf_financial_qa.workflow import ExtractionError

FAST = ClassifySettings(retry_interval=0.0)
ANNUAL = make_pdf([
    ["Synthetic Cements Limited", "Integrated Annual Report 2025-26", "CIN: L26940MH2001PLC123456"],
    ["Standalone Balance Sheet as at 31 March 2026", "Statement of Profit and Loss for the year ended 31 March 2026"],
])
UNKNOWN = make_pdf([["Synthetic Textiles Limited", "Kind words about the year gone by"]])


class ScriptedClassifier:
    name = "scripted-classifier"

    def __init__(self, answers=(), fail_first=None):
        self.answers = list(answers)
        self.fail_first = fail_first
        self.calls = []

    def classify(self, pdf, page_count, questions):
        self.calls.append([q.field for q in questions])
        if self.fail_first is not None:
            exc, self.fail_first = self.fail_first, None
            raise exc
        return ClassifyOutput(answers=self.answers)


def never():
    raise AssertionError("the model must not be asked")


class RunnerTests(unittest.TestCase):
    def test_rules_settle_everything_without_the_model(self):
        r = run_classification(ANNUAL, model_factory=never, settings=FAST)
        self.assertEqual((r.kind, r.model, r.prompt_version, r.warnings), ("annual_report", None, None, []))
        self.assertEqual(r.company_name_as_printed, "Synthetic Cements Limited")
        self.assertTrue(all(e.source == "rule" and e.text_layer_match for e in r.evidence))

    def test_only_open_answers_are_asked_and_a_checked_answer_is_kept(self):
        model = ScriptedClassifier([Answer(field="kind", value="other", page=1, quote="Kind words about the year gone by"),
                                    Answer(field="other_type", value="announcement", page=1, quote="Kind words about the year gone by")])
        r = run_classification(UNKNOWN, model_factory=lambda: model, settings=FAST)
        self.assertEqual(model.calls, [["kind", "other_type", "period", "results_span"]])
        self.assertEqual((r.kind, r.other_type, r.model), ("other", "announcement", "scripted-classifier"))
        self.assertTrue(r.prompt_version.startswith("classify-"))
        kind = next(e for e in r.evidence if e.field == "kind")
        self.assertEqual((kind.source, kind.page_index, kind.text_layer_match), ("model", 0, True))

    def test_statements_found_limit_an_open_kind_to_the_read_kinds(self):
        pdf = make_pdf([["Synthetic Textiles Limited", "Standalone Balance Sheet as at 31 March 2026"]])
        asked = []

        class Recording(ScriptedClassifier):
            def classify(self, pdf, page_count, questions):
                asked.extend(questions)
                return super().classify(pdf, page_count, questions)

        quote = "Standalone Balance Sheet as at 31 March 2026"
        model = Recording([Answer(field="kind", value="other", page=1, quote=quote)])
        r = run_classification(pdf, model_factory=lambda: model, settings=FAST)
        kind = next(q for q in asked if q.field == "kind")
        self.assertEqual(sorted(kind.allowed), ["annual_report", "financial_results"])
        self.assertNotIn("other_type", [q.field for q in asked])
        self.assertEqual(r.kind, "not_sure")
        self.assertIn("MODEL_ANSWER_DROPPED", [w.code for w in r.warnings])

    def test_a_quote_not_on_the_page_is_dropped(self):
        model = ScriptedClassifier([Answer(field="kind", value="annual_report", page=1, quote="Annual Report 2025-26")])
        r = run_classification(UNKNOWN, model_factory=lambda: model, settings=FAST)
        self.assertEqual(r.kind, "not_sure")
        self.assertIn("MODEL_ANSWER_DROPPED", [w.code for w in r.warnings])

    def test_a_page_outside_the_subset_is_dropped(self):
        model = ScriptedClassifier([Answer(field="kind", value="other", page=9, quote="Kind words")])
        r = run_classification(UNKNOWN, model_factory=lambda: model, settings=FAST)
        self.assertEqual(r.kind, "not_sure")
        self.assertIn("MODEL_ANSWER_DROPPED", [w.code for w in r.warnings])

    def test_a_value_outside_the_allowed_set_is_dropped(self):
        model = ScriptedClassifier([Answer(field="kind", value="brochure", page=1, quote="Kind words about the year gone by")])
        r = run_classification(UNKNOWN, model_factory=lambda: model, settings=FAST)
        self.assertEqual(r.kind, "not_sure")
        self.assertIn("MODEL_ANSWER_DROPPED", [w.code for w in r.warnings])

    def test_a_company_not_in_its_quote_is_dropped(self):
        pdf = make_pdf([["Kind words about the year gone by"]])
        model = ScriptedClassifier([Answer(field="company", value="Invented Industries Limited", page=1,
                                           quote="Kind words about the year gone by")])
        r = run_classification(pdf, model_factory=lambda: model, settings=FAST)
        self.assertIsNone(r.company_name_as_printed)

    def test_a_scanned_page_keeps_the_answer_unchecked(self):
        pdf = make_pdf([[]])
        model = ScriptedClassifier([Answer(field="kind", value="annual_report", page=1, quote="Annual Report 2025-26")])
        r = run_classification(pdf, model_factory=lambda: model, settings=FAST)
        self.assertEqual(r.kind, "annual_report")
        self.assertIsNone(next(e for e in r.evidence if e.field == "kind").text_layer_match)

    def test_no_model_configured_falls_back_to_rules(self):
        r = run_classification(UNKNOWN, model_factory=None, settings=FAST)
        self.assertEqual(r.kind, "not_sure")
        self.assertEqual([w.code for w in r.warnings], ["MODEL_UNAVAILABLE"])

    def test_a_factory_error_falls_back_to_rules(self):
        def broken():
            raise ExtractionError("EXTRACTOR_NOT_CONFIGURED", "GOOGLE_CLOUD_PROJECT is not set", retryable=False)
        r = run_classification(UNKNOWN, model_factory=broken, settings=FAST)
        self.assertEqual(([w.code for w in r.warnings], r.model), (["MODEL_UNAVAILABLE"], None))

    def test_a_transient_error_is_retried_once(self):
        model = ScriptedClassifier([Answer(field="kind", value="other", page=1, quote="Kind words about the year gone by")],
                                   fail_first=TimeoutError())
        r = run_classification(UNKNOWN, model_factory=lambda: model, settings=FAST)
        self.assertEqual((len(model.calls), r.kind), (2, "other"))
        self.assertEqual(r.other_type, "unlisted_type")

    def test_a_second_answer_for_the_same_field_is_dropped(self):
        quote = "Kind words about the year gone by"
        model = ScriptedClassifier([Answer(field="kind", value="other", page=1, quote=quote),
                                    Answer(field="kind", value="annual_report", page=1, quote=quote)])
        r = run_classification(UNKNOWN, model_factory=lambda: model, settings=FAST)
        self.assertEqual(r.kind, "other")
        self.assertEqual([e.field for e in r.evidence].count("kind"), 1)
        self.assertIn("MODEL_ANSWER_DROPPED", [w.code for w in r.warnings])

    def test_an_answer_for_a_field_not_asked_is_dropped(self):
        quote = "Kind words about the year gone by"
        model = ScriptedClassifier([Answer(field="kind", value="other", page=1, quote=quote),
                                    Answer(field="company", value="Synthetic Textiles Limited", page=1, quote=quote)])
        r = run_classification(UNKNOWN, model_factory=lambda: model, settings=FAST)
        self.assertNotIn("company", model.calls[0])  # the rules already read the company
        self.assertEqual([e.source for e in r.evidence if e.field == "company"], ["rule"])
        self.assertIn("MODEL_ANSWER_DROPPED", [w.code for w in r.warnings])

    def test_other_type_and_span_evidence_follow_the_kind(self):
        quote = "Kind words about the year gone by"
        model = ScriptedClassifier([Answer(field="kind", value="annual_report", page=1, quote=quote),
                                    Answer(field="other_type", value="announcement", page=1, quote=quote),
                                    Answer(field="results_span", value="quarter", page=1, quote=quote)])
        r = run_classification(UNKNOWN, model_factory=lambda: model, settings=FAST)
        self.assertEqual(r.kind, "annual_report")
        self.assertEqual({e.field for e in r.evidence} & {"other_type", "results_span"}, set())

    def test_a_model_without_a_name_degrades_to_rules(self):
        class Nameless:
            def classify(self, pdf, page_count, questions):
                return ClassifyOutput(answers=[])
        r = run_classification(UNKNOWN, model_factory=Nameless, settings=FAST)
        self.assertEqual(([w.code for w in r.warnings], r.model), (["MODEL_UNAVAILABLE"], None))

    def test_a_transient_error_twice_degrades_to_rules(self):
        class Always(ScriptedClassifier):
            def classify(self, pdf, page_count, questions):
                self.calls.append([q.field for q in questions])
                raise TimeoutError()
        model = Always()
        r = run_classification(UNKNOWN, model_factory=lambda: model, settings=FAST)
        self.assertEqual((len(model.calls), r.kind, r.model), (2, "not_sure", None))
        self.assertEqual([w.code for w in r.warnings], ["MODEL_UNAVAILABLE"])

    def test_a_non_transient_model_error_degrades_to_rules(self):
        model = ScriptedClassifier(fail_first=ValueError("bad"))
        r = run_classification(UNKNOWN, model_factory=lambda: model, settings=FAST)
        self.assertEqual((len(model.calls), r.kind, r.model), (1, "not_sure", None))
        self.assertEqual([w.code for w in r.warnings], ["MODEL_UNAVAILABLE"])

    def test_a_later_page_maps_back_to_its_original_index(self):
        quote = "Standalone Balance Sheet as at 31 March 2026"
        pdf = make_pdf([["Filler text"]] * 6 + [[quote]])
        model = ScriptedClassifier([Answer(field="kind", value="annual_report", page=6, quote=quote)])
        r = run_classification(pdf, model_factory=lambda: model, settings=FAST)
        self.assertEqual(r.kind, "annual_report")
        kind = next(e for e in r.evidence if e.field == "kind")
        self.assertEqual((kind.source, kind.page_index), ("model", 6))

    def test_an_unreadable_pdf_is_a_permanent_error(self):
        with self.assertRaises(ExtractionError) as caught:
            run_classification(b"%PDF-1.4 not really", model_factory=never, settings=FAST)
        self.assertEqual(caught.exception.code, "UNREADABLE_PDF")


if __name__ == "__main__":
    unittest.main()


class GeminiModelTests(unittest.TestCase):
    def test_the_client_does_not_retry_on_its_own(self):
        # The runner retries a transient failure once; a client retry on top would double the wait.
        with mock.patch("langchain_google_genai.ChatGoogleGenerativeAI") as chat:
            GeminiClassificationModel(project="p", location="l", model="m")
        self.assertEqual(chat.call_args.kwargs["max_retries"], 0)
