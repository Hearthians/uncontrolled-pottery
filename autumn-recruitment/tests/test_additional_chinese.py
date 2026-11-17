"""Body and original-time boundaries for additional public Chinese sources."""
from __future__ import annotations

import unittest
import json
from pathlib import Path
import tempfile

from autumn_recruitment.collectors.additional_chinese import (
    collect_nowcoder_with_page, normalize_bilibili_detail, normalize_nowcoder_state, nowcoder_search_links, nowcoder_state,
)


class AdditionalChineseTests(unittest.TestCase):
    def test_nowcoder_moment_uses_exact_main_content_and_original_time(self):
        identity = "0123456789abcdef0123456789abcdef"
        content = {"uuid": identity, "title": "秋招大败", "content": "面了很多次，还是<b>零 offer</b>。",
                   "userId": 42, "createdAt": 1725156000000, "editTime": 1794921276000}
        state = {"prefetchData": {"2": {"ssrCommonData": {"contentData": content,
                 "similarRecommend": [{"content": "旁边推荐，不是原帖"}]}}}}
        post = normalize_nowcoder_state(state, f"https://www.nowcoder.com/feed/main/detail/{identity}?sourceSSR=search")[0]
        self.assertEqual(post["text"], "秋招大败\n面了很多次，还是零 offer。")
        self.assertEqual(post["post_id"], identity)
        self.assertTrue(post["published_at"].startswith("2024-09-01"))
        self.assertTrue(post["updated_at"].startswith("2026-11-17"))
        self.assertEqual(post["author_id"], "42")
        self.assertEqual(post["raw"]["contentData"], content)
        self.assertNotIn("?", post["url"])
        content["ip4"] = "unneeded-source-metadata"
        content["userBrief"] = {"userId": 42, "city": "unneeded-profile-metadata"}
        limited = normalize_nowcoder_state(state, post["url"])[0]
        self.assertNotIn("ip4", limited["raw"]["contentData"])
        self.assertNotIn("userBrief", limited["raw"]["contentData"])

    def test_nowcoder_discussion_shape_uses_create_time_and_author_id(self):
        content = {"id": "1234", "uuid": "0123456789abcdef0123456789abcdef", "title": "秋招",
                   "content": "面试结束仍在等待结果", "authorId": 99, "createTime": 1725156000000}
        state = {"prefetchData": {"2": {"ssrCommonData": {"contentData": content}}}}
        post = normalize_nowcoder_state(state, "https://www.nowcoder.com/discuss/1234")[0]
        self.assertEqual(post["author_id"], "99")
        self.assertEqual(post["entry_type"], "post")
        self.assertIsNone(post["parent_id"])

    def test_nowcoder_missing_original_time_or_wrong_page_never_counts(self):
        content = {"uuid": "0123456789abcdef0123456789abcdef", "title": "秋招", "content": "完整求职正文",
                   "editTime": 1725156000000}
        state = {"prefetchData": {"2": {"ssrCommonData": {"contentData": content}}}}
        url = "https://www.nowcoder.com/feed/main/detail/0123456789abcdef0123456789abcdef"
        self.assertEqual(normalize_nowcoder_state(state, url), [])
        content["createdAt"] = 1725156000000
        self.assertEqual(normalize_nowcoder_state(state, url.replace("01234567", "99999999")), [])
        self.assertEqual(normalize_nowcoder_state(state, url.replace("www.nowcoder.com", "evil.example")), [])
        content["content"] = '<img src="https://images.example/screenshot.png">'
        self.assertEqual(normalize_nowcoder_state(state, url), [])

    def test_nowcoder_embedded_json_and_real_links_only(self):
        state = {"prefetchData": {"2": {"value": "中文"}}}
        import json
        html = f'<script>window.__INITIAL_STATE__={json.dumps(state)};(function(){{}})();</script>'
        self.assertEqual(nowcoder_state(html), state)
        self.assertEqual(nowcoder_state("<h1>no state</h1>"), {})
        link = "/feed/main/detail/0123456789abcdef0123456789abcdef"
        links = nowcoder_search_links(f'<a href="{link}?sourceSSR=search">摘要</a><a href="{link}">标题</a>'
                                     '<a href="https://evil.example/discuss/123">外链</a><a href="/discuss/comment/12">评论</a>')
        self.assertEqual(links, ["https://www.nowcoder.com" + link])

    def test_bilibili_only_accepts_full_detail_description_and_matching_id(self):
        detail = {"code": 0, "data": {"bvid": "BVtest", "aid": 123, "title": "秋招总结", "desc": "投了很多简历之后，终于拿到了满意的 offer。",
                                      "pubdate": 1725156000, "owner": {"mid": 42}}}
        post = normalize_bilibili_detail(detail, expected_bvid="BVtest")[0]
        self.assertEqual(post["entry_type"], "video_description")
        self.assertEqual(post["author_id"], "42")
        self.assertIn("满意的 offer", post["text"])
        self.assertEqual(normalize_bilibili_detail(detail, expected_bvid="wrong"), [])
        search = {"code": 0, "data": {"result": [{"bvid": "BVtest", "description": "摘要", "pubdate": 1725156000}]}}
        self.assertEqual(normalize_bilibili_detail(search, expected_bvid="BVtest"), [])
        detail["data"]["desc"] = "-"
        self.assertEqual(normalize_bilibili_detail(detail, expected_bvid="BVtest"), [])

    def test_browser_collection_stops_on_first_restricted_document(self):
        class Response:
            status = 403
            def text(self):
                return "<title>Access denied</title>"
        class Page:
            calls = []
            def goto(self, url, **kwargs):
                self.url = url
                self.calls.append(url)
                return Response()
        with tempfile.TemporaryDirectory() as temporary:
            page = Page()
            output = Path(temporary) / "posts.jsonl"
            result = collect_nowcoder_with_page(page, output=output, evidence_dir=Path(temporary) / "evidence",
                                                years=(2022, 2023), interval=0)
            self.assertEqual(result["status"], "blocked")
            self.assertEqual(result["records"], 0)
            self.assertEqual(len(page.calls), 1)
            self.assertEqual(output.read_text(), "")
            self.assertEqual(len(list((Path(temporary) / "evidence").glob("*.html"))), 1)

    def test_browser_collection_dates_by_original_time_despite_query_year(self):
        identity = "0123456789abcdef0123456789abcdef"
        url = "https://www.nowcoder.com/feed/main/detail/" + identity
        content = {"uuid": identity, "title": "秋招经历", "content": "面试很多次仍然没有 offer",
                   "createdAt": 1694772000000, "userId": 42, "ip4": "unneeded"}
        state = {"prefetchData": {"2": {"ssrCommonData": {"contentData": content}}}}
        detail = f'<script>window.__INITIAL_STATE__={json.dumps(state)};(function(){{}})();</script>'
        class Response:
            status = 200
            def __init__(self, body):
                self.body = body
            def text(self):
                return self.body
        class Page:
            calls = []
            def goto(self, target, **kwargs):
                self.url = target
                self.calls.append(target)
                return Response('<title>公开搜索页</title>' if "/search/all?" in target else detail)
            def content(self):
                return f'<a href="{url}">摘要</a><!--\ud83d-->'
            def wait_for_timeout(self, _):
                pass
        with tempfile.TemporaryDirectory() as temporary:
            page = Page()
            output = Path(temporary) / "posts.jsonl"
            result = collect_nowcoder_with_page(page, output=output, evidence_dir=Path(temporary) / "evidence",
                                                years=(2022, 2023), per_year=1, search_pages=1, interval=0)
            post = json.loads(output.read_text())
            self.assertEqual(result["counts"], {2023: 1})
            self.assertEqual(result["shortfalls"], {2022: 1, 2023: 0})
            self.assertEqual(post["query"], "2022秋招")
            self.assertTrue(post["published_at"].startswith("2023-09-15"))
            self.assertNotIn("ip4", post["raw"]["contentData"])
            self.assertEqual(page.calls.count(url), 1)


if __name__ == "__main__":
    unittest.main()
