"""HTTP integration checks for the local dashboard's export-only boundary."""
from __future__ import annotations

import copy
from contextlib import redirect_stdout
import io
import json
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

    def test_static_allowlist_and_head_health(self):
        _, text = self.get("/")
        self.assertIn("<title>秋招", text)
        for path in ("/config.json", "/data/study.sqlite3", "/../config.json", "/%2e%2e/config.json", "/outputs/sample.jsonl", "/web/../config.json"):
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
