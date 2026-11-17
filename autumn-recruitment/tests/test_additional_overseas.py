from __future__ import annotations

from datetime import datetime, timezone
import io
import json
from pathlib import Path
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch
from urllib.error import HTTPError

from autumn_recruitment.collectors.additional_overseas import (Collector, CollectionStopped, PublicAPI, hn_candidate,
    in_year, normalize_hn, normalize_workplace, stable_order, window)


class AdditionalOverseasTests(unittest.TestCase):
    def test_public_api_stops_after_one_403_or_429_without_retry(self):
        for status in (403, 429):
            with self.subTest(status=status), tempfile.TemporaryDirectory() as folder:
                api = PublicAPI(Path(folder), delay=0)
                error = HTTPError("https://hn.algolia.com/api/v1/search", status, "Restricted", {}, io.BytesIO(b"restricted"))
                with patch("autumn_recruitment.collectors.additional_overseas.urlopen", side_effect=error) as request:
                    with self.assertRaisesRegex(CollectionStopped, str(status)):
                        api.get("https://hn.algolia.com/api/v1/search")
                self.assertEqual(request.call_count, 1)
                self.assertEqual(api.requests, 1)

    def test_public_api_honors_backoff_and_quota_before_another_request(self):
        for response_data in ({"items": [], "backoff": 90, "quota_remaining": 100}, {"items": [], "quota_remaining": 1}):
            with self.subTest(response=response_data), tempfile.TemporaryDirectory() as folder:
                api = PublicAPI(Path(folder), delay=0)
                response = io.BytesIO(json.dumps(response_data).encode())
                response.status = 200
                with patch("autumn_recruitment.collectors.additional_overseas.urlopen", return_value=response) as request:
                    api.get("https://api.stackexchange.com/2.3/search/advanced?site=workplace")
                    with self.assertRaises(CollectionStopped):
                        api.get("https://api.stackexchange.com/2.3/search/advanced?site=workplace&q=jobs")
                self.assertEqual(request.call_count, 1)

    def test_study_window_uses_beijing_not_utc_calendar_days(self):
        first, end = window(2024)
        self.assertEqual(datetime.fromtimestamp(first, timezone.utc).isoformat(), "2024-07-31T16:00:00+00:00")
        self.assertEqual(datetime.fromtimestamp(end, timezone.utc).isoformat(), "2024-11-17T16:00:00+00:00")
        self.assertTrue(in_year(first, 2024))
        self.assertFalse(in_year(first - 1, 2024))
        self.assertFalse(in_year(end, 2024))

    def test_hn_uses_matching_original_body_and_rejects_dead_or_mismatched_items(self):
        moment = window(2024)[0] + 1000
        body = "The job market is difficult for new graduates. I have applied to many jobs and interviewed at several companies, but I am still looking for work."
        hit = {"objectID": "123", "created_at_i": moment, "_tags": ["comment"], "comment_text": body[:90], "story_title": "Ask HN: Job search advice", "story_id": 100, "parent_id": 101}
        candidate = hn_candidate(hit, 2024)
        item = {"id": 123, "time": moment, "by": "author", "type": "comment", "parent": 101, "text": f"<p>{body}</p>"}
        result = normalize_hn(candidate, item, '"job market"', 2024)
        self.assertEqual(result["text"], body)
        self.assertEqual((result["thread_id"], result["parent_id"], result["entry_type"]), ("100", "101", "comment"))
        self.assertEqual(result["raw"]["item"], item)
        for overrides in ({"id": 456}, {"time": moment + 1}, {"deleted": True}, {"dead": True}, {"parent": 999}, {"by": ""}):
            self.assertIsNone(normalize_hn(candidate, {**item, **overrides}, "job market", 2024))

    def test_hn_job_ad_threads_and_link_headlines_are_not_opinions(self):
        moment = window(2024)[0] + 1000
        body = "The job market and hiring practices are changing. We are hiring a new graduate with a competitive salary and excellent benefits at our company."
        hit = {"objectID": "123", "created_at_i": moment, "_tags": ["comment"], "comment_text": body, "story_title": "Ask HN: Who is hiring?"}
        self.assertIsNone(hn_candidate(hit, 2024))
        story = {**hit, "_tags": ["story"], "story_text": body, "story_title": None, "title": "Ask HN: How is the job market?"}
        candidate = hn_candidate(story, 2024)
        item = {"id": 123, "time": moment, "by": "author", "type": "story", "title": story["title"], "text": body, "url": "https://example.invalid/article"}
        self.assertIsNone(normalize_hn(candidate, item, "job market", 2024))

    def test_political_job_market_keyword_without_employment_context_is_not_selected(self):
        hit = {"objectID": "123", "created_at_i": window(2024)[0] + 1000, "_tags": ["comment"],
               "story_title": "New policy proposed during an election", "comment_text": "Politicians always move in the direction of what improves the job market for lawyers. More complex legal code will lead to more bureaucracy and expensive paperwork."}
        self.assertIsNone(hn_candidate(hit, 2024))

    def test_workplace_answers_keep_own_body_and_creation_time(self):
        moment = window(2024)[0] + 1000
        body = "I went through a difficult interview process and continued my job search after the rejection. You should keep applying to other employers while waiting."
        question = {"question_id": 100, "title": "How should I continue my job search?"}
        answer = {"answer_id": 200, "question_id": 100, "creation_date": moment, "last_activity_date": window(2025)[0], "body": f"<p>{body}</p>", "owner": {"user_id": 12}, "content_license": "CC BY-SA 4.0"}
        result = normalize_workplace(answer, 2024, "job search", question=question)
        self.assertEqual(result["text"], body)
        self.assertEqual(result["entry_type"], "answer")
        self.assertEqual((result["thread_id"], result["parent_id"]), ("100", "100"))
        self.assertEqual(datetime.fromisoformat(result["published_at"]).year, 2024)
        self.assertEqual(result["content_license"], "CC BY-SA 4.0")
        self.assertIsNone(normalize_workplace({**answer, "creation_date": window(2025)[0]}, 2024, "job search", question=question))

    def test_month_order_and_caps_prevent_one_thread_or_author_filling_year(self):
        posts = [{"post_id": f"{month}-{i}", "published_at": f"2024-{month:02}-10T10:00:00+08:00"} for month in [8, 9, 10, 11] for i in range(3)]
        first = stable_order(posts)[:4]
        self.assertEqual({datetime.fromisoformat(p["published_at"]).month for p in first}, {8, 9, 10, 11})
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            (root / "data/raw/additional").mkdir(parents=True)
            collector = Collector(SimpleNamespace(root=root), "hackernews", 40)
            for i in range(8):
                collector.remember({"post_id": str(i), "season_year": 2024, "author_id": "same", "thread_id": "thread", "text": f"unique text {i}", "published_at": "2024-09-01T00:00:00Z"})
            self.assertEqual(collector.count(2024), 3)
            saved = [json.loads(line) for line in collector.output.read_text().splitlines()]
            self.assertEqual(len(saved), 3)


if __name__ == "__main__":
    unittest.main()
