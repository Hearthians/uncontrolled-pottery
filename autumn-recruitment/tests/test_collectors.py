"""Offline fixtures exercise source shapes, temporal sampling, and API pagination."""
from __future__ import annotations

import io
import json
import os
import sys
import tempfile
import unittest
from pathlib import Path
from types import ModuleType, SimpleNamespace
from unittest.mock import MagicMock, patch
from urllib.error import HTTPError
from urllib.parse import parse_qs, urlparse

from autumn_recruitment.collectors import CollectorError, build_browser_search_url, collect_browser, collect_x_api, extract_posts, import_posts
from autumn_recruitment.collectors.normalize import date_window, in_window, timestamp


class CollectorTests(unittest.TestCase):
    def test_canonical_plaintext_round_trip_preserves_code_and_entities(self):
        body = 'Interview feedback: use List<T>, write &gt; literally.\n  Keep indentation.'
        record = {"platform": "hackernews", "post_id": "42", "text": body,
                  "published_at": "2024-09-01T01:00:00Z", "author_id": "author",
                  "url": "https://news.ycombinator.com/item?id=42"}
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory)/"posts.jsonl"
            path.write_text(json.dumps(record)+"\n", encoding="utf-8")
            imported = import_posts(path, "hackernews")[0]
        self.assertEqual(imported["text"], body)

    def test_additional_source_import_preserves_thread_and_language_metadata(self):
        record = {"platform": "workplace", "post_id": "answer:42", "text": "The job search has been exhausting.",
                  "published_at": "2024-09-10T13:00:00Z", "url": "https://workplace.stackexchange.com/a/42",
                  "entry_type": "answer", "thread_id": "40", "parent_id": "40", "language": "en",
                  "market_region": "international_unspecified", "updated_at": "2025-01-01T00:00:00Z",
                  "temporal_review": {"exclude_from_season": True}}
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory)/"posts.jsonl"
            path.write_text(json.dumps(record)+"\n", encoding="utf-8")
            imported = import_posts(path, "workplace")[0]
        self.assertEqual(imported["post_id"], "answer:42")
        self.assertEqual(imported["published_at"], "2024-09-10T13:00:00+00:00")
        for field in ("entry_type", "thread_id", "parent_id", "language", "market_region", "updated_at", "temporal_review"):
            self.assertEqual(imported[field], record[field])

    def test_xhs_security_error_stops_but_missing_note_is_not_a_security_gate(self):
        from autumn_recruitment.collectors.browser import _check_page
        page = MagicMock()
        for code in ("300012", "300013"):
            page.url = f"https://www.xiaohongshu.com/website-login/error?error_code={code}"
            with self.subTest(code=code), self.assertRaisesRegex(CollectorError, "安全限制"):
                _check_page(page)
        page.url = "https://www.xiaohongshu.com/website-login/error?error_code=300031"
        page.locator.return_value.first.is_visible.return_value = False
        _check_page(page)

    def test_dataabc_export_preserves_ids_and_chinese_timezone(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "weibo.csv"
            path.write_text("微博id,微博正文,日期,点赞数,评论数,转发数\n001234567890123456,秋招终于有面试了,2024-09-01 10:00,1.2万,3,2\n001234567890123456,重复,2024-09-01 10:00,1,0,0\n", encoding="utf-8-sig")
            rows = import_posts(path, "weibo")
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["post_id"], "001234567890123456")
        self.assertEqual(rows[0]["published_at"], "2024-09-01T02:00:00+00:00")
        self.assertEqual(rows[0]["likes"], 12000)

    def test_import_does_not_invent_missing_dates(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "notes.jsonl"
            path.write_text('{"note_id":"n1","desc":"秋招好难"}\n', encoding="utf-8")
            with self.assertRaisesRegex(CollectorError, "第 1 条"):
                import_posts(path, "xiaohongshu")

    def test_yearless_publication_dates_are_rejected(self):
        for value in ("09-01 10:00", "9月1日 10:00", "11月17日", "今天 10:00"):
            with self.subTest(value=value), self.assertRaises(ValueError):
                timestamp(value, "weibo")

    def test_all_platform_windows_use_china_dates_but_x_posts_remain_utc(self):
        for platform in ("weibo", "xiaohongshu", "x"):
            with self.subTest(platform=platform):
                window = date_window("2024-09-01", "2024-10-01", platform)
                self.assertEqual(window[0].isoformat(), "2024-08-31T16:00:00+00:00")
                self.assertEqual(window[1].isoformat(), "2024-09-30T16:00:00+00:00")
                self.assertTrue(in_window({"published_at": "2024-08-31T16:00:00+00:00"}, window))
                self.assertFalse(in_window({"published_at": "2024-09-30T16:00:00+00:00"}, window))
        self.assertEqual(timestamp("2024-09-01T00:00:00Z", "x"), "2024-09-01T00:00:00+00:00")

    def test_browser_urls_cover_china_windows_with_source_date_semantics(self):
        x_url = build_browser_search_url("x", "秋招", "2024-09-01", "2024-10-01")
        self.assertEqual(parse_qs(urlparse(x_url).query)["q"], ["秋招 since:2024-08-31 until:2024-10-01"])
        exact_utc_url = build_browser_search_url("x", "秋招", "2024-09-01T00:00:00Z", "2024-10-01T00:00:00Z")
        self.assertEqual(parse_qs(urlparse(exact_utc_url).query)["q"], ["秋招 since:2024-09-01 until:2024-10-01"])
        weibo_url = build_browser_search_url("weibo", "秋招", "2024-09-01", "2024-10-01")
        self.assertEqual(parse_qs(urlparse(weibo_url).query)["timescope"], ["custom:2024-09-01:2024-09-30"])

    def test_weibo_mobile_cards_and_date_filter(self):
        payload = {"data": {"cards": [{"card_group": [{"mblog": {"idstr": "123", "text": "秋招<br>喜提<b>大礼包</b>", "created_at": "Sun Sep 01 10:00:00 +0800 2024", "attitudes_count": 20, "user": {"id": 1}}}]}]}}
        rows = extract_posts("weibo", payload, "秋招")
        self.assertEqual(rows[0]["text"], "秋招\n喜提大礼包")
        self.assertTrue(in_window(rows[0], date_window("2024-09-01", "2024-10-01", "weibo")))
        self.assertFalse(in_window(rows[0], date_window("2024-08-01", "2024-09-01", "weibo")))

    def test_xhs_waits_for_detail_timestamp_and_ignores_comment_objects(self):
        summary = {"data": {"items": [{"id": "abc", "note_card": {"display_title": "秋招焦虑"}}], "comments": [{"id": "comment", "content": "不该当成帖子", "time": 1725156000000}]}}
        self.assertEqual(extract_posts("xiaohongshu", summary), [])
        dated_summary = {"data": {"items": [{"id": "abc", "note_card": {"display_title": "秋招焦虑", "time": 1725156000000}}]}}
        self.assertEqual(extract_posts("xiaohongshu", dated_summary), [])
        detail = {"data": {"items": [{"id": "abc", "note_card": {"title": "秋招焦虑", "desc": "投了好多简历", "time": 1725156000000, "interact_info": {"liked_count": "1.1万"}, "user": {"user_id": "u1"}}}]}}
        rows = extract_posts("xiaohongshu", detail)
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["text"], "秋招焦虑\n投了好多简历")
        self.assertEqual(rows[0]["author_id"], "u1")
        self.assertEqual(rows[0]["likes"], 11000)

    def test_xhs_search_excerpt_does_not_satisfy_limit_before_full_detail(self):
        identity = "0123456789abcdef01234567"
        link = f"https://www.xiaohongshu.com/explore/{identity}?xsec_token=browser-issued"
        callbacks = []
        context, page = MagicMock(), MagicMock()
        context.pages = [page]
        context.on.side_effect = lambda event, callback: callbacks.append(callback)
        page.locator.return_value.first.is_visible.return_value = False
        response = MagicMock()
        response.url = "https://edith.xiaohongshu.com/api/sns/web/v1/search/notes"
        response.status = 200
        response.json.return_value = {"data": {"items": [{"id": identity, "xsec_token": "browser-issued", "note_card": {
            "title": "秋招", "desc": "摘要", "time": 1725156000000}}]}}
        def navigate(url, **kwargs):
            page.url = url
            if "search_result?" in url:
                callbacks[-1](response)
        page.goto.side_effect = navigate
        state = {"noteDetailMap": {identity: {"note": {"noteId": identity, "title": "秋招", "desc": "完整正文与真实求职经历",
                                                    "time": 1725156000000, "user": {"userId": "author"}}}}}
        page.evaluate.side_effect = lambda script: [link] if "section.note-item" in script else state
        runtime, manager = MagicMock(), MagicMock()
        runtime.chromium.launch_persistent_context.return_value = context
        manager.__enter__.return_value = runtime
        sync_module = ModuleType("playwright.sync_api")
        sync_module.sync_playwright = lambda: manager
        with tempfile.TemporaryDirectory() as directory, patch.dict(sys.modules, {"playwright": ModuleType("playwright"), "playwright.sync_api": sync_module}):
            rows = collect_browser("xiaohongshu", "秋招", "2024-09-01", "2024-10-01", Path(directory)/"profile", Path(directory)/"raw.jsonl", limit=1)
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["text"], "秋招\n完整正文与真实求职经历")
        self.assertEqual(rows[0]["raw"]["source"], "rendered_note_state")
        context.close.assert_called_once()

    def test_x_search_timeline_does_not_collect_recommended_users(self):
        tweet = {"rest_id": "123", "legacy": {"full_text": "今年秋招压力大", "created_at": "Sun Sep 01 02:00:00 +0000 2024", "user_id_str": "42", "favorite_count": 2}}
        payload = {"data": {"search_by_raw_query": {"search_timeline": {"timeline": {"instructions": [{"entries": [{"content": {"itemContent": {"tweet_results": {"result": {"__typename": "TweetWithVisibilityResults", "tweet": tweet}}}}}, {"content": {"itemContent": {"user_results": {"result": tweet}}}}]}]}}}}}
        rows = extract_posts("x", payload)
        self.assertEqual([row["post_id"] for row in rows], ["123"])

    @patch.dict(os.environ, {"TEST_X_TOKEN": "fixture-token"})
    def test_official_x_api_paginates_and_enforces_exclusive_end(self):
        pages = [
            {"data": [{"id": "1", "text": "秋招", "created_at": "2024-09-01T00:00:00Z"}], "meta": {"next_token": "page-2"}},
            {"data": [{"id": "1", "text": "重复", "created_at": "2024-09-01T00:00:00Z"}, {"id": "2", "text": "边界", "created_at": "2024-10-01T00:00:00Z"}, {"id": "3", "text": "焦虑", "created_at": "2024-09-02T00:00:00Z"}]},
        ]
        responses = [io.StringIO(json.dumps(page)) for page in pages]
        with tempfile.TemporaryDirectory() as directory, patch("autumn_recruitment.collectors.x_api.urlopen", side_effect=responses) as mocked:
            output = Path(directory) / "x.jsonl"
            rows = collect_x_api("秋招", "2024-09-01", "2024-10-01", output, limit=2, bearer_env="TEST_X_TOKEN")
            self.assertEqual([row["post_id"] for row in rows], ["1", "3"])
            self.assertEqual(len(output.read_text(encoding="utf-8").splitlines()), 2)
            self.assertIn("next_token=page-2", mocked.call_args_list[1].args[0].full_url)
            self.assertTrue(mocked.call_args_list[0].args[0].full_url.startswith("https://api.x.com/2/tweets/search/all?"))
            self.assertEqual(parse_qs(urlparse(mocked.call_args_list[0].args[0].full_url).query)["start_time"], ["2024-08-31T16:00:00Z"])

    @patch.dict(os.environ, {"TEST_X_TOKEN": "fixture-token"})
    def test_x_api_checkpoints_before_later_bad_response_or_interrupt(self):
        first_page = {"data": [{"id": "1", "text": "秋招", "created_at": "2024-09-01T00:00:00Z"}], "meta": {"next_token": "page-2"}}
        for failure in ([], {"data": {}}, KeyboardInterrupt()):
            with self.subTest(failure=type(failure).__name__), tempfile.TemporaryDirectory() as directory:
                output = Path(directory) / "x.jsonl"
                calls = []

                def fake_request(*args, **kwargs):
                    calls.append(True)
                    if len(calls) == 1:
                        return io.StringIO(json.dumps(first_page))
                    self.assertEqual(json.loads(output.read_text(encoding="utf-8"))["post_id"], "1")
                    if isinstance(failure, BaseException):
                        raise failure
                    return io.StringIO(json.dumps(failure))

                with patch("autumn_recruitment.collectors.x_api.urlopen", side_effect=fake_request):
                    with self.assertRaises((CollectorError, KeyboardInterrupt)):
                        collect_x_api("秋招", "2024-09-01", "2024-10-01", output, limit=2, bearer_env="TEST_X_TOKEN")
                self.assertEqual(json.loads(output.read_text(encoding="utf-8"))["post_id"], "1")

    def test_browser_interrupt_saves_collected_posts(self):
        callbacks = []
        context = MagicMock()
        page = MagicMock()
        context.pages = [page]
        context.on.side_effect = lambda event, callback: callbacks.append(callback)
        response = MagicMock()
        response.url = "https://weibo.com/ajax/statuses/show?id=123"
        response.status = 200
        response.json.return_value = {"idstr": "123", "text": "秋招焦虑", "created_at": "Sun Sep 01 10:00:00 +0800 2024"}
        page.goto.side_effect = lambda *args, **kwargs: callbacks[-1](response)
        page.wait_for_timeout.side_effect = KeyboardInterrupt
        runtime = MagicMock()
        runtime.chromium.launch_persistent_context.return_value = context
        manager = MagicMock()
        manager.__enter__.return_value = runtime
        sync_module = ModuleType("playwright.sync_api")
        sync_module.sync_playwright = lambda: manager
        for options in ({}, {"headless": True, "executable_path": Path("/usr/bin/chromium")}, {"proxy_server": "http://127.0.0.1:7890"}):
            with self.subTest(options=options), tempfile.TemporaryDirectory() as directory, patch.dict(sys.modules, {"playwright": ModuleType("playwright"), "playwright.sync_api": sync_module}):
                context.close.reset_mock()
                output = Path(directory) / "weibo.jsonl"
                with self.assertRaises(KeyboardInterrupt):
                    collect_browser("weibo", "秋招", "2024-09-01", "2024-10-01", Path(directory) / "profile", output, **options)
                self.assertEqual(json.loads(output.read_text(encoding="utf-8"))["post_id"], "123")
                context.close.assert_called_once()
                launch_kwargs = runtime.chromium.launch_persistent_context.call_args.kwargs
                self.assertEqual(launch_kwargs["headless"], options.get("headless", False))
                if "executable_path" in options:
                    self.assertEqual(launch_kwargs["executable_path"], str(Path("/usr/bin/chromium")))
                else:
                    self.assertNotIn("executable_path", launch_kwargs)
                if "proxy_server" in options:
                    self.assertEqual(launch_kwargs["proxy"], {"server": options["proxy_server"]})
                else:
                    self.assertNotIn("proxy", launch_kwargs)

    def test_browser_cli_accepts_headless_and_executable_overrides(self):
        from autumn_recruitment.cli import make_parser
        command = ["collect-browser", "--platform", "weibo", "--query", "秋招", "--start", "2024-09-01", "--end", "2024-10-01"]
        defaults = make_parser().parse_args(command)
        self.assertFalse(defaults.headless)
        self.assertIsNone(defaults.browser_executable)
        self.assertIsNone(defaults.proxy_server)
        overrides = make_parser().parse_args(command + ["--headless", "--browser-executable", "/usr/bin/chromium", "--proxy-server", "socks5://127.0.0.1:7891"])
        self.assertTrue(overrides.headless)
        self.assertEqual(overrides.browser_executable, "/usr/bin/chromium")
        self.assertEqual(overrides.proxy_server, "socks5://127.0.0.1:7891")

    def test_proxy_validation_rejects_credentials_without_echoing_input(self):
        from autumn_recruitment.collectors.browser import _validate_proxy_server
        for scheme in ("http", "https", "socks5"):
            with self.subTest(scheme=scheme):
                value = f"{scheme}://127.0.0.1:7890"
                self.assertEqual(_validate_proxy_server(value), value)
        for value in ("http://private-user:private-secret@localhost:7890", "ftp://localhost:7890", "http://localhost:99999", "http://localhost/path", "http://localhost?token=private-secret", "http://[malformed", "http://localhost\n:7890"):
            with self.subTest(value=value), self.assertRaises(ValueError) as caught:
                _validate_proxy_server(value)
            self.assertNotIn("private-user", str(caught.exception))
            self.assertNotIn("private-secret", str(caught.exception))
            self.assertNotIn(value, str(caught.exception))

    def test_x_onboarding_login_gate_is_detected_from_url(self):
        from autumn_recruitment.collectors.browser import _check_page
        page = SimpleNamespace(url="https://x.com/i/jf/onboarding/web?flow_name=login&mode=login")
        with self.assertRaisesRegex(CollectorError, "需要先登录平台"):
            _check_page(page)

    def test_other_onboarding_modes_are_not_login_gates(self):
        from autumn_recruitment.collectors.browser import _check_page
        for url in (
            "https://x.com/i/jf/onboarding/web?mode=signup",
            "https://x.com/i/jf/onboarding/web",
            "https://x.com/search?mode=login",
            "https://example.com/i/jf/onboarding/web?mode=login",
        ):
            with self.subTest(url=url):
                page = MagicMock()
                page.url = url
                page.locator.return_value.first.is_visible.return_value = False
                _check_page(page)

    @patch.dict(os.environ, {"TEST_X_TOKEN": "fixture-token"})
    def test_archive_denial_is_explicit_and_does_not_fallback(self):
        denied = HTTPError("https://api.x.com", 403, "Forbidden", {}, None)
        with tempfile.TemporaryDirectory() as directory, patch("autumn_recruitment.collectors.x_api.urlopen", side_effect=denied) as mocked:
            with self.assertRaisesRegex(CollectorError, "历史搜索需要相应权限"):
                collect_x_api("秋招", "2024-09-01", "2024-10-01", Path(directory) / "x.jsonl", bearer_env="TEST_X_TOKEN")
            self.assertEqual(mocked.call_count, 1)


if __name__ == "__main__":
    unittest.main()
