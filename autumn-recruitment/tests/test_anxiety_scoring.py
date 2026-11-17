"""External-output failures and resumability of the one-time anxiety scorer."""
from __future__ import annotations

import argparse
import copy
from contextlib import redirect_stdout
import io
import json
from pathlib import Path
import runpy
import tempfile
import unittest
from unittest.mock import patch

from autumn_recruitment.llm import LLMSettings

ROOT = Path(__file__).resolve().parents[1]
SCORER = runpy.run_path(str(ROOT / "scripts/score-anxiety.py"), run_name="anxiety_scoring_tests")


class AnxietyScoringTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix="test-anxiety-", dir=ROOT / "data")
        self.base = Path(self.temporary.name)
        self.output = self.base / "anxiety-v1"
        for folder in ("records", "requests"):
            (self.output / folder).mkdir(parents=True)
        rows = [{"platform": "weibo", "post_id": str(i), "text": f"Post {i}: I am worried about tomorrow.",
                 "season_year": 2026, "published_at": "2026-09-01T00:00:00+08:00", "url": "https://weibo.com/post",
                 "analysis": {"id": f"weibo:{i}", "relevant": True, "sentiment": "negative", "emotions": ["焦虑"], "intensity": 2}}
                for i in range(6)]
        (self.base / "sample.jsonl").write_text("".join(json.dumps(row) + "\n" for row in rows))
        self.args = argparse.Namespace(scope="all", workers=1, retry_errors=False, export_only=False, model="test-model")
        self.settings = LLMSettings("https://test.invalid/v1", "test-model", "test-not-a-secret")

    def tearDown(self):
        self.temporary.cleanup()

    def execute(self, request):
        # runpy functions retain a separate globals mapping; patch that mapping directly.
        function = SCORER["execute"]
        with patch.dict(function.__globals__, {"load_settings": lambda: self.settings}), \
             patch.object(SCORER["LLMClient"], "_request", side_effect=request), redirect_stdout(io.StringIO()):
            return function(self.args, self.base, self.output)

    @staticmethod
    def response(payload, invalid_id=None):
        posts = json.loads(payload["input"])["posts"]
        items = [{"case_id": row["case_id"], "score": .4, "assessable": True, "confidence": .9,
                  "evidence": ["fabricated evidence" if row["case_id"] == invalid_id else "worried about tomorrow"],
                  "reason": "明确担心明天"} for row in posts]
        return {"id": "test-response", "model": "test-model", "status": "completed", "output_text": json.dumps({"items": items})}

    def test_repairs_only_invalid_records_and_reuses_valid_cache_without_api(self):
        sizes = []
        def request(endpoint, payload):
            posts = json.loads(payload["input"])["posts"]
            sizes.append(len(posts))
            return self.response(payload, posts[0]["case_id"] if len(sizes) == 1 else None)
        self.assertEqual(self.execute(request), 0)
        self.assertEqual(sizes, [6, 1])
        raw = list((self.output / "requests").glob("*.json"))
        self.assertEqual(len(raw), 2)
        self.assertTrue(all("response" in json.loads(file.read_text()) for file in raw))
        self.assertEqual(self.execute(lambda *_: self.fail("Completed records were billed twice")), 0)
        self.assertEqual(json.loads((self.output / "summary.json").read_text())["completed"], 6)

    def test_network_failure_is_saved_and_not_blindly_retried(self):
        calls = []
        def request(*_):
            calls.append(1)
            raise TimeoutError("test timeout")
        self.assertEqual(self.execute(request), 1)
        self.assertEqual(len(calls), 1)
        summary = json.loads((self.output / "summary.json").read_text())
        self.assertEqual(summary["error"], 6)
        self.assertEqual(summary["completed"], 0)
        self.assertEqual(self.execute(lambda *_: self.fail("Failure was retried without explicit retry-errors")), 1)
        self.args.retry_errors = True
        self.assertEqual(self.execute(lambda endpoint, payload: self.response(payload)), 0)

    def test_real_zero_and_unknown_are_distinct_and_bad_numeric_types_rejected(self):
        validate = SCORER["validate_item"]
        row = {"case_id": "p1", "text": "A factual statement."}
        item = {"case_id": "p1", "score": 0, "assessable": True, "confidence": .9, "evidence": [], "reason": "无焦虑表达"}
        self.assertEqual(validate(item, row)[0]["score"], 0)
        self.assertIsNone(validate({**item, "score": None, "assessable": False}, row)[0]["score"])
        for value in (True, float("nan"), -0.1, 1.1):
            with self.subTest(value=value), self.assertRaises(ValueError):
                validate({**item, "score": value}, row)

    def test_incomplete_responses_are_saved_before_completion_validation(self):
        calls = []
        def request(endpoint, payload):
            calls.append(endpoint)
            return {"id": f"incomplete-{len(calls)}", "model": "test-model", "status": "incomplete",
                    "output_text": "partial model output", "usage": {"output_tokens": 20}}
        self.assertEqual(self.execute(request), 1)
        raw = [json.loads(file.read_text()) for file in (self.output / "requests").glob("*.json")
               if not file.name.endswith("-validation.json")]
        self.assertEqual(len(calls), 3)
        self.assertEqual(len(raw), 3)
        self.assertTrue(all(value["response"]["status"] == "incomplete" for value in raw))
        self.assertTrue(all(value["response"]["usage"]["output_tokens"] == 20 for value in raw))

    def test_incomplete_chat_responses_are_saved_before_choice_validation(self):
        self.settings.api = "chat_completions"
        def request(endpoint, payload):
            self.assertEqual(endpoint, "/chat/completions")
            return {"id": "incomplete-chat", "model": "test-model", "choices": [
                {"finish_reason": "length", "message": {"content": "partial JSON"}}]}
        self.assertEqual(self.execute(request), 1)
        raw = [json.loads(file.read_text()) for file in (self.output / "requests").glob("*.json")
               if not file.name.endswith("-validation.json")]
        self.assertEqual(len(raw), 3)
        self.assertTrue(all(value["response"]["choices"][0]["finish_reason"] == "length" for value in raw))

    def test_unexpected_validation_error_preserves_received_response_and_can_recover(self):
        function = SCORER["execute"]
        with patch.dict(function.__globals__, {"validate_item": lambda *_: (_ for _ in ()).throw(RuntimeError("validator interrupted"))}):
            self.assertEqual(self.execute(lambda endpoint, payload: self.response(payload)), 1)
        raw_file = next((self.output / "requests").glob("*.json"))
        raw = json.loads(raw_file.read_text())
        self.assertIn("response", raw)
        self.assertEqual(raw["response"]["id"], "test-response")
        self.assertEqual(raw["error_type"], "RuntimeError")
        self.assertEqual(self.execute(lambda *_: self.fail("Saved valid response was billed twice")), 0)
        rows = [json.loads(line) for line in (self.output / "scores.jsonl").read_text().splitlines()]
        self.assertTrue(all(row["status"] == "scored" for row in rows))
        self.assertTrue(all(row["raw_file"] == raw_file.relative_to(self.output).as_posix() for row in rows))

    def test_interrupted_record_writes_recover_from_raw_without_api(self):
        self.assertEqual(self.execute(lambda endpoint, payload: self.response(payload)), 0)
        files = sorted((self.output / "records").glob("*.json"))
        expected_links = {json.loads(file.read_text())["record_id"]: json.loads(file.read_text())["raw_file"] for file in files}
        for file in files[:2]:
            file.unlink()
        request_files = set((self.output / "requests").glob("*.json"))
        self.assertEqual(self.execute(lambda *_: self.fail("Interrupted valid outputs were billed twice")), 0)
        self.assertEqual(set((self.output / "requests").glob("*.json")), request_files)
        recovered = [json.loads(file.read_text()) for file in (self.output / "records").glob("*.json")]
        self.assertEqual(len(recovered), 6)
        self.assertTrue(all(row["raw_file"] == expected_links[row["record_id"]] for row in recovered))

    def test_invalid_cache_is_quarantined_and_pending_when_raw_cannot_recover(self):
        self.assertEqual(self.execute(lambda endpoint, payload: self.response(payload)), 0)
        cache = next((self.output / "records").glob("*.json"))
        value = json.loads(cache.read_text())
        value["score"] = 1.2
        cache.write_text(json.dumps(value))
        for file in (self.output / "requests").glob("*.json"):
            file.unlink()
        self.args.export_only = True
        self.assertEqual(self.execute(lambda *_: self.fail("Export-only made an API call")), 1)
        summary = json.loads((self.output / "summary.json").read_text())
        self.assertEqual(summary["completed"], 5)
        self.assertEqual(summary["pending"], 1)
        self.assertFalse(cache.exists())
        quarantined = list((self.output / "quarantine").glob("*.json"))
        self.assertEqual(len(quarantined), 1)
        self.assertEqual(json.loads(quarantined[0].read_text())["score"], 1.2)

    def test_invalid_cache_can_be_replaced_from_valid_raw_without_api(self):
        self.assertEqual(self.execute(lambda endpoint, payload: self.response(payload)), 0)
        cache = next((self.output / "records").glob("*.json"))
        value = json.loads(cache.read_text())
        value["evidence"] = ["fabricated cache quote"]
        cache.write_text(json.dumps(value))
        self.assertEqual(self.execute(lambda *_: self.fail("Recoverable cache caused another API call")), 0)
        self.assertEqual(json.loads(cache.read_text())["evidence"], ["worried about tomorrow"])
        self.assertEqual(len(list((self.output / "quarantine").glob("*.json"))), 1)

    def test_raw_recovery_checks_request_and_response_identity_and_full_text(self):
        self.assertEqual(self.execute(lambda endpoint, payload: self.response(payload)), 0)
        raw_file = next((self.output / "requests").glob("*.json"))
        saved = json.loads(raw_file.read_text())
        source = [json.loads(line) for line in (self.base / "sample.jsonl").read_text().splitlines()]
        rows = {f"p{index + 1:05d}": {**row, "case_id": f"p{index + 1:05d}"} for index, row in enumerate(source)}
        recover = SCORER["recoverable_items"]
        self.assertEqual(len(recover(saved, rows, "test-model")), 6)
        variants = []
        for key, value in (("model", "another-model"), ("prompt_version", "older-prompt"),
                           ("prompt_sha256", "0" * 64), ("schema_sha256", "0" * 64)):
            altered = copy.deepcopy(saved)
            altered[key] = value
            variants.append(altered)
        altered = copy.deepcopy(saved)
        altered["response"]["model"] = "another-model"
        variants.append(altered)
        altered = copy.deepcopy(saved)
        altered["inputs"][0]["text"] += " changed body"
        variants.append(altered)
        altered = copy.deepcopy(saved)
        altered["inputs"][0]["case_id"] = "foreign-post"
        variants.append(altered)
        for altered in variants:
            with self.subTest(altered=altered), self.assertRaises(ValueError):
                recover(altered, rows, "test-model")


if __name__ == "__main__":
    unittest.main()
