from __future__ import annotations

import copy
import json
import os
import sys
import tempfile
import unittest
from pathlib import Path
from urllib.parse import parse_qs, urlparse

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from autumn_recruitment.config import PROJECT_ROOT, load_config
from autumn_recruitment.pipeline import clean_posts, make_plan, select_sample
from autumn_recruitment.storage import Storage, content_hash


def post(identifier="1", year=2022, platform="weibo", **updates):
    item = {"platform": platform, "post_id": identifier,
            "text": f"秋招面试记录第{identifier}条，等待回复中。",
            "published_at": f"{year}-09-01T10:00:00+08:00",
            "url": f"https://example.invalid/{platform}/{identifier}",
            "raw": {"source_field": "untouched"}}
    item.update(updates)
    return item


class PlanningAndSamplingTests(unittest.TestCase):
    def setUp(self):
        self.config = load_config()

    def test_default_config_is_independent_of_working_directory(self):
        original = Path.cwd()
        try:
            os.chdir(PROJECT_ROOT / "data")
            result = load_config()
        finally:
            os.chdir(original)
        self.assertEqual(result["config_path"], str(PROJECT_ROOT / "config.json"))
        self.assertTrue(Path(result["db_path"]).is_relative_to(PROJECT_ROOT))

    def test_plan_has_total_not_per_year_platform_quota(self):
        jobs = make_plan(self.config)
        for platform in ("weibo", "xiaohongshu", "x"):
            subset = [job for job in jobs if job["platform"] == platform]
            self.assertEqual(sum(job["quota"] for job in subset), 200)
            self.assertEqual({job["year_quota"] for job in subset}, {40})
        weibo = next(job for job in jobs if job["platform"] == "weibo" and job["year"] == 2022)
        params = parse_qs(urlparse(weibo["search_url"]).query)
        self.assertEqual(params["timescope"], ["custom:2022-08-01:2022-11-17"])
        xjob = next(job for job in jobs if job["platform"] == "x")
        xquery = parse_qs(urlparse(xjob["search_url"]).query)["q"][0]
        self.assertIn("since:2022-07-31", xquery)
        self.assertIn("until:2022-11-18", xquery)

    def test_x_plan_utc_days_cover_beijing_first_day_and_exact_sample_bounds(self):
        config = copy.deepcopy(self.config)
        config["years"] = [2022]
        items = [post("before", platform="x", published_at="2022-07-31T15:59:59Z"),
                 post("first", platform="x", published_at="2022-07-31T16:00:00Z"),
                 post("last", platform="x", published_at="2022-11-17T15:59:59Z"),
                 post("after", platform="x", published_at="2022-11-17T16:00:00Z")]
        sample = select_sample(items, config)
        self.assertEqual({item["post_id"] for item in sample}, {"first", "last"})
        config["timezone"] = "UTC"
        job = next(job for job in make_plan(config) if job["platform"] == "x")
        query = parse_qs(urlparse(job["search_url"]).query)["q"][0]
        self.assertIn("since:2022-08-01", query)
        self.assertIn("until:2022-11-18", query)

    def test_local_season_boundaries_original_dates_and_cohort(self):
        items = [
            post("start", published_at="2022-07-31T16:00:00Z"),
            post("end_in", published_at="2022-11-17T23:59:59+08:00"),
            post("end_out", published_at="2022-11-18T00:00:00+08:00"),
            post("start_out", published_at="2022-07-31T23:59:59+08:00"),
            post("naive", published_at="2022-09-01T10:00:00"),
            post("wrong", season_year=2023),
            post("cohort", text="2023届毕业生，2022年秋招面试实录"),
        ]
        cleaned = clean_posts(items, self.config)
        self.assertEqual({item["post_id"] for item in cleaned}, {"start", "end_in", "cohort"})
        cohort = next(item for item in cleaned if item["post_id"] == "cohort")
        self.assertEqual(cohort["season_year"], 2022)
        self.assertEqual(cohort["graduation_cohort"], 2023)
        self.assertNotIn("season_year", items[0])

    def test_dedup_relevance_and_obvious_commercial_ads(self):
        items = [post("1"), post("1"), post("2", text=post("1")["text"]),
                 post("3", text="秋招辅导课程报名，现在购买限时优惠"),
                 post("4", text="今天午饭很好吃，天气也不错"),
                 post("5", platform="x", text=post("1")["text"])]
        cleaned = clean_posts(items, self.config)
        self.assertEqual({(item["platform"], item["post_id"]) for item in cleaned},
                         {("weibo", "1"), ("x", "5")})

    def test_verified_later_revision_excluded_without_guessing_from_metadata(self):
        revised = post("edited", platform="xiaohongshu", temporal_review={
            "exclude_from_season": True, "reason": "正文含次年新增求职结果", "evidence": "2023年更新"})
        metadata_only = post("metadata", platform="xiaohongshu", updated_at="2023-01-01T12:00:00+08:00")
        self.assertEqual([p["post_id"] for p in clean_posts([revised, metadata_only], self.config)], ["metadata"])
        self.assertIn("temporal_review", revised)

    def test_balanced_sample_is_order_independent_and_does_not_fill_shortages(self):
        config = copy.deepcopy(self.config)
        config["years"] = [2022, 2023]
        config["target_per_platform"] = 6
        posts = [post(str(index), 2022) for index in range(10)] + [post("only", 2023)]
        sample = select_sample(posts, config)
        reverse = select_sample(list(reversed(posts)), config)
        self.assertEqual(sample, reverse)
        self.assertEqual(sum(item["season_year"] == 2022 for item in sample), 3)
        self.assertEqual(sum(item["season_year"] == 2023 for item in sample), 1)

    def test_author_limit_prevents_a_single_author_filling_a_season(self):
        config = copy.deepcopy(self.config)
        config["years"] = [2022]
        config["target_per_platform"] = 10
        config["sampling"]["max_per_author_per_year"] = 2
        sample = select_sample([post(str(index), author_id="same") for index in range(10)], config)
        self.assertEqual(len(sample), 2)

    def test_available_mode_keeps_year_imbalance_and_author_limit_explicit(self):
        config = copy.deepcopy(self.config)
        config["years"] = [2022, 2023]
        config["target_per_platform"] = 2
        config["sampling"].update(mode="available", max_per_author_per_year=2)
        items = [post(str(i), 2022, author_id="same") for i in range(4)] + [post("later", 2023)]
        sample = select_sample(items, config)
        self.assertEqual(sum(p["season_year"] == 2022 for p in sample), 2)
        self.assertEqual(sum(p["season_year"] == 2023 for p in sample), 1)


class StorageTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix="test-", dir=PROJECT_ROOT / "data")
        self.db = Storage(Path(self.temporary.name) / "study.sqlite3")

    def tearDown(self):
        self.db.close()
        self.temporary.cleanup()

    def test_unique_post_identity_and_original_raw_versions(self):
        first = post()
        self.assertEqual(self.db.upsert_posts([first]), {"inserted": 1, "updated": 0, "skipped": 0})
        self.db.upsert_posts([first])
        edited = post(text="秋招进展：今天终于拿到 offer！", raw={"source_field": "changed"})
        counts = self.db.upsert_posts([edited, post(platform="x"), post("bad", text="")])
        self.assertEqual(counts, {"inserted": 1, "updated": 1, "skipped": 1})
        self.assertEqual(len(self.db.list_posts()), 2)
        self.assertEqual(self.db.list_posts("weibo")[0]["raw"], {"source_field": "changed"})
        originals = self.db.connection.execute("SELECT record_json FROM raw_records WHERE platform = 'weibo'").fetchall()
        self.assertEqual(len(originals), 2)

    def test_analysis_cache_separates_text_model_and_prompt_versions(self):
        item = post()
        self.db.upsert_posts([item])
        digest = content_hash(item["text"])
        label = {"topics": ["面试体验"], "sentiment": "negative"}
        self.db.save_analysis("weibo", "1", label, "model-a", "v1", digest)
        self.assertEqual(self.db.get_analysis("weibo", "1", digest, "model-a", "v1"), label)
        self.assertIsNone(self.db.get_analysis("weibo", "1", digest, "model-b", "v1"))
        self.assertIsNone(self.db.get_analysis("weibo", "1", digest, "model-a", "v2"))
        changed = content_hash("更新后的秋招经历")
        self.assertIsNone(self.db.get_analysis("weibo", "1", changed, "model-a", "v1"))
        self.db.save_analysis("weibo", "1", label, "model-a", "v2", digest)
        self.assertEqual(len(self.db.list_analyses()), 2)

    def test_recapture_preserves_temporal_review_without_altering_raw_input(self):
        review = {"exclude_from_season": True, "evidence": "2023年更新"}
        self.db.upsert_posts([post(platform="xiaohongshu", temporal_review=review)])
        recaptured = post(platform="xiaohongshu", raw={"source_field": "recaptured"})
        self.db.upsert_posts([recaptured])
        self.assertEqual(self.db.list_posts()[0]["temporal_review"], review)
        self.assertNotIn("temporal_review", recaptured)
        self.assertEqual(clean_posts(self.db.list_posts(), load_config()), [])
        latest_raw = self.db.connection.execute(
            "SELECT record_json FROM raw_records ORDER BY id DESC LIMIT 1").fetchone()
        self.assertEqual(json.loads(latest_raw["record_json"]), recaptured)

    def test_explicit_temporal_review_can_override_previous_exclusion(self):
        for replacement in ({"exclude_from_season": False, "reason": "人工复核已解除"}, None):
            with self.subTest(replacement=replacement):
                self.db.upsert_posts([post(platform="xiaohongshu", temporal_review={"exclude_from_season": True})])
                updated = post(platform="xiaohongshu", temporal_review=replacement)
                self.db.upsert_posts([updated])
                self.assertEqual(self.db.list_posts()[0]["temporal_review"], replacement)
                self.assertEqual(len(clean_posts(self.db.list_posts(), load_config())), 1)


if __name__ == "__main__":
    unittest.main()
