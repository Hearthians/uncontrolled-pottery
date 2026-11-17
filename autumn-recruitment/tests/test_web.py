"""HTTP integration checks for the local dashboard's export-only boundary."""
from __future__ import annotations

import copy
from contextlib import redirect_stdout
import hashlib
import io
import json
import os
from pathlib import Path
import tempfile
from threading import Thread
import unittest
from unittest.mock import patch
from urllib.error import HTTPError
from urllib.request import Request, urlopen

from autumn_recruitment import cli
from autumn_recruitment.config import PROJECT_ROOT, load_config
from autumn_recruitment.web import create_server, source_url


class DashboardTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix="test-web-", dir=PROJECT_ROOT / "data")
        self.root = Path(self.temporary.name)
        self.config = copy.deepcopy(load_config())
        self.config["project_root"] = str(self.root)
        self.summary = {"selected": 1, "labelled": 1, "model": "test-model", "prompt_version": "v2",
                        "sampling_mode": "balanced", "groups": [{"platform": "xiaohongshu", "season_year": 2026,
                        "selected": 1, "labelled": 1, "relevant": 1, "topics": {"笔试面试": 1},
                        "emotions": {"焦虑": 1}, "sentiments": {"negative": 1}, "private_path": "hidden-marker"}],
                        "credential_source": "hidden-marker", "limitations": ["测试数据"]}
        self.post = {"platform": "xiaohongshu", "post_id": "note", "text": "秋招面试让人焦虑", "published_at": "2026-09-01T10:00:00+08:00",
                     "season_year": 2026, "url": "https://www.xiaohongshu.com/explore/note?xsec_token=hidden-marker#token",
                     "raw": {"cookie": "hidden-marker"}, "author_id": "hidden-marker", "collected_at": "hidden-marker",
                     "analysis": {"id": "xiaohongshu:note", "relevant": True, "sentiment": "negative", "emotions": ["焦虑"],
                                  "topics": ["笔试面试"], "evidence": ["焦虑"], "confidence": 0.9, "intensity": 2,
                                  "private": "hidden-marker"}}
        self.write_export(self.root / "outputs", self.summary, self.post)
        supplement = copy.deepcopy(self.summary)
        supplement.update(selected=2, labelled=2, sampling_mode="available")
        self.write_export(self.root / "outputs/xiaohongshu-available", supplement, self.post)
        web = self.root / "web"
        web.mkdir()
        (web / "index.html").write_text("<!doctype html><title>秋招</title>", encoding="utf-8")
        (web / "app.js").write_text("console.log('dashboard')", encoding="utf-8")
        self.catalog = {"样本说明": "About the sample"}
        (web / "content.en.json").write_text(json.dumps(self.catalog, ensure_ascii=False), encoding="utf-8")
        (self.root / "config.json").write_text('{"key":"hidden-marker"}', encoding="utf-8")
        self.server = create_server(self.config, port=0)
        self.thread = Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.origin = f"http://127.0.0.1:{self.server.server_port}"

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join(timeout=2)
        self.temporary.cleanup()

    def write_export(self, path, summary, post):
        path.mkdir(parents=True)
        (path / "summary.json").write_text(json.dumps(summary, ensure_ascii=False), encoding="utf-8")
        (path / "sample.jsonl").write_text(json.dumps(post, ensure_ascii=False) + "\n", encoding="utf-8")
        (path / "quality-audit.json").write_text(json.dumps({"raw_post_counts": {"xiaohongshu": 250}, "integrity_check": "ok",
            "selected": 1, "windows_path": "hidden-marker", "label_validation_errors": []}), encoding="utf-8")

    def get(self, path):
        with urlopen(self.origin + path, timeout=2) as response:
            return response, response.read().decode("utf-8")

    def score_row(self, **changes):
        row = {"record_id": "xiaohongshu:note", "text_sha256": hashlib.sha256(self.post["text"].encode()).hexdigest(),
               "status": "scored", "score": 0.7, "assessable": True, "evidence": ["焦虑"],
               "reason": "作者明确表达面试焦虑", "confidence": 0.95,
               "model": "gpt-6.1-sol", "prompt_version": "anxiety-intensity-v1",
               "raw_response": "hidden-marker", "request_path": "hidden-marker"}
        row.update(changes)
        return row

    def write_scores(self, rows):
        folder = self.root / "outputs/combined/anxiety-v1"
        folder.mkdir(parents=True, exist_ok=True)
        file = folder / "scores.jsonl"
        file.write_text("".join(json.dumps(row, ensure_ascii=False) + "\n" for row in rows), encoding="utf-8")
        return file

    def test_dashboard_preserves_counts_and_strips_private_fields(self):
        response, text = self.get("/api/dashboard")
        data = json.loads(text)
        self.assertEqual(response.status, 200)
        self.assertEqual(data["summary"]["groups"][0]["sentiments"], {"negative": 1})
        self.assertEqual(data["quality"]["raw_post_counts"], {"xiaohongshu": 250})
        self.assertEqual(data["posts"][0]["url"], "https://www.xiaohongshu.com/explore/note")
        self.assertNotIn("hidden-marker", text)
        self.assertNotIn("raw", data["posts"][0])
        self.assertNotIn("author_id", data["posts"][0])
        self.assertNotIn("private", data["posts"][0]["analysis"])
        self.assertEqual(data["meta"]["years"], [2026])
        self.assertEqual(len(data["meta"]["available_datasets"]), 2)
        self.assertEqual(data["meta"]["platforms"], [{"id": "xiaohongshu", "label": "小红书"}])
        self.assertEqual(response.headers["Cache-Control"], "no-store")
        self.assertEqual(data["posts"][0]["anxiety"]["status"], "pending")
        self.assertEqual(data["summary"]["anxiety"], {"total": 1, "scored": 0, "unassessable": 0, "pending": 1, "error": 0})

    def test_anxiety_score_is_bound_to_text_and_exposes_display_fields_only(self):
        self.write_scores([self.score_row()])
        _, text = self.get("/api/dashboard")
        data = json.loads(text)
        score = data["posts"][0]["anxiety"]
        self.assertEqual(score, {"status": "scored", "score": 0.7, "evidence": ["焦虑"],
                                "reason": "作者明确表达面试焦虑", "confidence": 0.95,
                                "model": "gpt-6.1-sol", "prompt_version": "anxiety-intensity-v1"})
        self.assertEqual(data["summary"]["anxiety"]["scored"], 1)
        self.assertNotIn("hidden-marker", text)
        self.assertNotIn("text_sha256", score)

    def test_anxiety_zero_and_unassessable_are_different(self):
        for row in (self.score_row(score=0, evidence=[]),
                    self.score_row(status="unassessable", score=None, assessable=False, evidence=[], reason="语境不足")):
            with self.subTest(status=row["status"]):
                self.write_scores([row])
                _, text = self.get("/api/dashboard")
                data = json.loads(text)
                self.assertEqual(data["posts"][0]["anxiety"]["status"], row["status"])
                self.assertEqual(data["posts"][0]["anxiety"]["score"], row["score"])
                self.assertEqual(data["summary"]["anxiety"][row["status"]], 1)
                self.assertEqual(data["summary"]["anxiety"]["pending"], 0)

    def test_anxiety_changed_text_or_old_prompt_stays_pending(self):
        for changes in ({"text_sha256": "0" * 64}, {"prompt_version": "old-version"}):
            with self.subTest(changes=changes):
                self.write_scores([self.score_row(**changes)])
                _, text = self.get("/api/dashboard")
                score = json.loads(text)["posts"][0]["anxiety"]
                self.assertEqual(score["status"], "pending")
                self.assertIsNone(score["score"])

    def test_anxiety_rejects_invalid_values_and_unsupported_evidence(self):
        invalid = ({"score": True}, {"score": float("nan")}, {"score": float("inf")}, {"score": 1.01},
                   {"confidence": True}, {"assessable": False}, {"evidence": []},
                   {"evidence": ["invented quote"]}, {"status": "unknown"}, {"reason": ""})
        for changes in invalid:
            with self.subTest(changes=changes):
                self.write_scores([self.score_row(**changes)])
                _, text = self.get("/api/dashboard")
                score = json.loads(text)["posts"][0]["anxiety"]
                self.assertEqual(score["status"], "error")
                self.assertIsNone(score["score"])
                self.assertNotIn("hidden-marker", text)

    def test_anxiety_explicit_errors_do_not_expose_runner_details(self):
        self.write_scores([self.score_row(status="error", score=None, assessable=False,
                                         evidence=[], reason="hidden-marker /private/path/API key")])
        _, text = self.get("/api/dashboard")
        data = json.loads(text)
        self.assertEqual(data["posts"][0]["anxiety"]["status"], "error")
        self.assertEqual(data["summary"]["anxiety"]["error"], 1)
        self.assertNotIn("hidden-marker", text)
        self.assertNotIn("/private/path", text)

    def test_unassessable_result_requires_an_explicit_null_score(self):
        row = self.score_row(status="unassessable", score=None, assessable=False, evidence=[])
        del row["score"]
        self.write_scores([row])
        response, text = self.get("/api/dashboard")
        self.assertEqual(response.status, 200)
        self.assertEqual(json.loads(text)["posts"][0]["anxiety"]["status"], "error")

    def test_duplicate_anxiety_ids_are_invalid_and_other_ids_do_not_match(self):
        for rows, expected in (([self.score_row(), self.score_row(score=.2)], "error"),
                               ([self.score_row(record_id="nowcoder:note")], "pending")):
            with self.subTest(expected=expected):
                self.write_scores(rows)
                _, text = self.get("/api/dashboard")
                self.assertEqual(json.loads(text)["posts"][0]["anxiety"]["status"], expected)

    def test_invalid_anxiety_file_keeps_original_dashboard_readable(self):
        file = self.write_scores([])
        for content in ("not-json hidden-marker\n", "[]\n", '{"score": 0.9}\n'):
            with self.subTest(content=content):
                file.write_text(content, encoding="utf-8")
                response, text = self.get("/api/dashboard")
                data = json.loads(text)
                self.assertEqual(response.status, 200)
                self.assertEqual(data["posts"][0]["text"], self.post["text"])
                self.assertEqual(data["posts"][0]["anxiety"]["status"], "error")
                self.assertNotIn("hidden-marker", text)

    def test_combined_dataset_reuses_scores_and_preserves_default_api(self):
        combined = copy.deepcopy(self.summary)
        combined.update(study_scope="combined_employment", sampling_mode="merged", study_name="全平台合并集")
        self.write_export(self.root / "outputs/combined", combined, self.post)
        self.write_scores([self.score_row()])
        _, text = self.get("/api/dashboard?dataset=combined")
        data = json.loads(text)
        self.assertEqual(data["dataset"], "combined")
        self.assertEqual(data["summary"]["sampling_mode"], "merged")
        self.assertEqual(data["posts"][0]["anxiety"]["score"], .7)
        self.assertEqual({item["id"] for item in data["meta"]["available_datasets"]},
                         {"combined", "balanced", "xiaohongshu-available"})
        _, default = self.get("/api/dashboard")
        self.assertEqual(json.loads(default)["dataset"], "balanced")
        self.assertEqual(json.loads(default)["posts"][0]["anxiety"], data["posts"][0]["anxiety"])

    def test_anxiety_summary_counts_each_state_and_includes_score_update_time(self):
        posts = []
        scores = []
        for index, status in enumerate(("scored", "unassessable", "error", "pending")):
            post = copy.deepcopy(self.post)
            post["post_id"] = str(index)
            post["analysis"]["id"] = f"xiaohongshu:{index}"
            posts.append(post)
            if status != "pending":
                scores.append(self.score_row(record_id=post["analysis"]["id"], status=status,
                                             score=0 if status == "scored" else None,
                                             assessable=status == "scored", evidence=[]))
        (self.root / "outputs/sample.jsonl").write_text("".join(json.dumps(post, ensure_ascii=False) + "\n" for post in posts), encoding="utf-8")
        file = self.write_scores(scores)
        os.utime(file, (2_000_000_000, 2_000_000_000))
        _, text = self.get("/api/dashboard")
        data = json.loads(text)
        self.assertEqual(data["summary"]["anxiety"], {"total": 4, "scored": 1, "unassessable": 1, "pending": 1, "error": 1})
        self.assertTrue(data["meta"]["updated_at"].startswith("2033-"))

    def test_dataset_selection_is_explicit_and_unknown_rejected(self):
        _, text = self.get("/api/dashboard?dataset=xiaohongshu-available")
        data = json.loads(text)
        self.assertEqual(data["dataset"], "xiaohongshu-available")
        self.assertEqual(data["summary"]["selected"], 2)
        for query in ("unknown", "../config.json", "balanced&dataset=xiaohongshu-available"):
            with self.subTest(query=query), self.assertRaises(HTTPError) as failure:
                self.get("/api/dashboard?dataset=" + query)
            self.assertEqual(failure.exception.code, 400)
            failure.exception.close()

    def test_additional_datasets_preserve_scope_and_safe_entry_metadata(self):
        groups = {
            "additional-chinese": ("campus_recruitment", ["nowcoder", "bilibili", "zhihu"]),
            "overseas-employment": ("overseas_employment", ["hackernews", "workplace", "mastodon", "reddit", "bluesky"]),
        }
        for name, (study_scope, platforms) in groups.items():
            summary = copy.deepcopy(self.summary)
            summary.update(study_scope=study_scope, study_name="独立研究范围", description="来源与统计范围说明",
                           groups=[dict(self.summary["groups"][0], platform=platform) for platform in platforms])
            posts = [dict(self.post, platform=platform, entry_type="comment", thread_id="thread-1",
                          parent_id="parent-1", language="en", market_region="international_unspecified")
                     for platform in platforms]
            folder = self.root / "outputs" / name
            self.write_export(folder, summary, posts[0])
            (folder / "sample.jsonl").write_text("\n".join(json.dumps(post) for post in posts), encoding="utf-8")
        for name, (study_scope, platforms) in groups.items():
            with self.subTest(dataset=name):
                _, text = self.get("/api/dashboard?dataset=" + name)
                data = json.loads(text)
                self.assertEqual(data["summary"]["study_scope"], study_scope)
                self.assertEqual(data["summary"]["study_name"], "独立研究范围")
                self.assertEqual(data["summary"]["description"], "来源与统计范围说明")
                self.assertEqual([p["id"] for p in data["meta"]["platforms"]], platforms)
                self.assertEqual(len(data["meta"]["available_datasets"]), 4)
                self.assertEqual([p["platform"] for p in data["posts"]], platforms)
                for post in data["posts"]:
                    for field, expected in (("entry_type", "comment"), ("thread_id", "thread-1"),
                                            ("parent_id", "parent-1"), ("language", "en"),
                                            ("market_region", "international_unspecified")):
                        self.assertEqual(post[field], expected)
                self.assertNotIn("hidden-marker", text)

    def test_static_allowlist_and_head_health(self):
        _, text = self.get("/")
        self.assertIn("<title>秋招", text)
        response, text = self.get("/content.en.json")
        self.assertEqual(response.status, 200)
        self.assertEqual(json.loads(text), self.catalog)
        self.assertEqual(response.headers["Content-Type"], "application/json; charset=utf-8")
        self.assertEqual(int(response.headers["Content-Length"]), len(text.encode("utf-8")))
        self.assertEqual(response.headers["Cache-Control"], "no-store")
        self.assertEqual(response.headers["X-Content-Type-Options"], "nosniff")
        self.assertEqual(response.headers["Referrer-Policy"], "no-referrer")
        policy = response.headers["Content-Security-Policy"]
        for directive in ("default-src 'self'", "script-src 'self'", "connect-src 'self'",
                          "base-uri 'none'", "frame-ancestors 'none'"):
            self.assertIn(directive, policy)
        with urlopen(Request(self.origin + "/content.en.json", method="HEAD"), timeout=2) as head:
            self.assertEqual(head.status, 200)
            self.assertEqual(head.headers["Content-Type"], response.headers["Content-Type"])
            self.assertEqual(head.headers["Content-Length"], response.headers["Content-Length"])
            self.assertEqual(head.headers["Cache-Control"], "no-store")
            self.assertEqual(head.read(), b"")
        for path in ("/config.json", "/data/study.sqlite3", "/../config.json", "/%2e%2e/config.json", "/outputs/sample.jsonl", "/outputs/combined/anxiety-v1/scores.jsonl", "/web/../config.json"):
            with self.subTest(path=path), self.assertRaises(HTTPError) as failure:
                self.get(path)
            self.assertEqual(failure.exception.code, 404)
            failure.exception.close()
        with urlopen(Request(self.origin + "/health", method="HEAD"), timeout=2) as response:
            self.assertEqual(response.status, 200)
            self.assertEqual(response.read(), b"")

    def test_missing_or_invalid_export_has_actionable_error_without_paths(self):
        path = self.root / "outputs/summary.json"
        path.unlink()
        with self.assertRaises(HTTPError) as failure:
            self.get("/api/dashboard")
        self.assertEqual(failure.exception.code, 404)
        text = failure.exception.read().decode("utf-8")
        failure.exception.close()
        self.assertIn("export", text)
        self.assertNotIn(str(self.root), text)
        path.write_text("incomplete JSON", encoding="utf-8")
        with self.assertRaises(HTTPError) as failure:
            self.get("/api/dashboard")
        self.assertEqual(failure.exception.code, 503)
        failure.exception.close()

    def test_source_urls_reject_unrelated_hosts_and_credentials(self):
        for value in ("javascript:alert(1)", "https://evil.example/note", "https://www.xiaohongshu.com.evil.example/note",
                      "https://user:secret@www.xiaohongshu.com/note", "https://www.xiaohongshu.com:8080/note", "http://www.xiaohongshu.com/note"):
            with self.subTest(url=value):
                self.assertEqual(source_url(value, "xiaohongshu"), "")

    def test_new_platform_permalink_hosts_are_exact_and_tokens_removed(self):
        origins = {"nowcoder": "www.nowcoder.com", "bilibili": "www.bilibili.com", "zhihu": "www.zhihu.com",
                   "workplace": "workplace.stackexchange.com", "mastodon": "mastodon.social",
                   "reddit": "www.reddit.com", "bluesky": "bsky.app"}
        for platform, host in origins.items():
            with self.subTest(platform=platform):
                self.assertEqual(source_url(f"https://{host}:443/post/123?token=hidden-marker#fragment", platform), f"https://{host}/post/123")
                self.assertEqual(source_url(f"https://{host}.evil.example/post/123", platform), "")
                self.assertEqual(source_url(f"https://user:secret@{host}/post/123", platform), "")
        for host in ("hachyderm.io", "isdream.ing", "mastodon.gamedev.place", "mstdn.social", "toot.majorshouse.com", "universeodon.com"):
            self.assertEqual(source_url(f"https://{host}/@user/123?token=hidden-marker", "mastodon"), f"https://{host}/@user/123")
        self.assertEqual(source_url("https://unverified-mastodon.example/@user/123", "mastodon"), "")

    def test_hackernews_permalink_preserves_one_ascii_numeric_id_only(self):
        self.assertEqual(source_url("https://news.ycombinator.com/item?id=123&token=hidden-marker#comments", "hackernews"),
                         "https://news.ycombinator.com/item?id=123")
        self.assertEqual(source_url("https://news.ycombinator.com/item?id=%31%32%33", "hackernews"),
                         "https://news.ycombinator.com/item?id=123")
        for query in ("", "id=", "id=abc", "id=-1", "id=１２３", "id=1&id=2", "id=1&id=1"):
            with self.subTest(query=query):
                self.assertEqual(source_url("https://news.ycombinator.com/item?" + query, "hackernews"), "")
        self.assertEqual(source_url("https://news.ycombinator.com/?token=hidden-marker", "hackernews"),
                         "https://news.ycombinator.com/")

    def test_serve_command_does_not_open_storage_or_model(self):
        output = io.StringIO()
        with patch.object(cli, "Storage") as storage, patch.object(cli, "load_settings") as model, patch("autumn_recruitment.web.serve") as server, redirect_stdout(output):
            result = cli.main(["serve", "--port", "8766"])
        self.assertEqual(result, 0)
        storage.assert_not_called()
        model.assert_not_called()
        self.assertEqual(server.call_args.args[1:], ("127.0.0.1", 8766))


if __name__ == "__main__":
    unittest.main()
