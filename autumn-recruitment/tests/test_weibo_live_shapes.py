import unittest
from types import SimpleNamespace

from autumn_recruitment.collectors.weibo import normalize_search_rows, resolve_missing_dates
from autumn_recruitment.collectors.normalize import CollectorError


class WeiboSearchCardsTest(unittest.TestCase):
    def test_original_chinese_date_and_full_text_card(self):
        row = {"id": "1234", "text": "秋招面试终于结束了\n希望顺利拿到 offer。", "date": "2025年09月17日 22:53 ",
               "url": "https://weibo.com/5678/abc", "author_url": "https://weibo.com/u/5678", "has_full_text": True, "truncated": False}
        results = normalize_search_rows([row], "秋招", "https://s.weibo.com/weibo")
        self.assertEqual(len(results), 1)
        self.assertEqual(results[0]["published_at"], "2025-09-17T14:53:00+00:00")
        self.assertEqual(results[0]["author_id"], "5678")
        self.assertEqual(results[0]["text"], row["text"])
        self.assertEqual(results[0]["raw"]["source"], "authenticated_search_dom")

    def test_unknown_year_or_unexpanded_excerpt_is_ineligible(self):
        complete = {"id": "1", "text": "秋招完整正文", "date": "2025年09月17日 22:53", "truncated": False}
        rows = [{**complete, "date": "09月17日 22:53"}, {**complete, "truncated": True}, {**complete, "date": "刚刚"}]
        self.assertEqual(normalize_search_rows(rows, "秋招"), [])

    def test_verified_fold_control_removed_without_changing_preserved_raw(self):
        row = {"id": "1", "text": "秋招焦虑，我想收起之前的抱怨\n收起d\u200b", "date": "2025年09月17日 22:53"}
        result = normalize_search_rows([row], "秋招")[0]
        self.assertEqual(result["text"], "秋招焦虑，我想收起之前的抱怨")
        self.assertEqual(result["raw"]["text"], row["text"])

    def fake_search_page(self, status=200, post_id="1234"):
        response = SimpleNamespace(url="https://weibo.com/ajax/statuses/show?id=abc", status=status,
                                   json=lambda: {"idstr": post_id, "created_at": "Mon Aug 31 22:57:55 +0800 2026"})
        class Detail:
            closed = False
            visited = []
            def expect_response(self, predicate, **kwargs):
                assert predicate(response)
                class Event:
                    value = response
                    def __enter__(self): return self
                    def __exit__(self, *_): pass
                return Event()
            def goto(self, url, **kwargs): self.visited.append(url)
            def wait_for_timeout(self, *_): pass
            def close(self): self.closed = True
        detail = Detail()
        return SimpleNamespace(context=SimpleNamespace(new_page=lambda: detail)), detail

    def test_yearless_card_uses_matching_normal_detail_metadata(self):
        row = {"id": "1234", "text": "秋招完整正文保留", "date": "08月31日 22:57", "url": "https://weibo.com/5678/abc"}
        page, detail = self.fake_search_page()
        resolved = resolve_missing_dates(page, [row])
        post = normalize_search_rows(resolved, "秋招")[0]
        self.assertEqual(post["published_at"], "2026-08-31T14:57:55+00:00")
        self.assertEqual(post["text"], row["text"])
        self.assertEqual(row["date"], "08月31日 22:57")
        self.assertTrue(detail.closed)
        self.assertEqual(detail.visited, [row["url"]])

    def test_mismatched_metadata_never_supplies_year_and_limits_skip_navigation(self):
        row = {"id": "1234", "text": "秋招完整正文", "date": "08月31日 22:57", "url": "https://weibo.com/5678/abc"}
        page, detail = self.fake_search_page(post_id="9999")
        self.assertEqual(normalize_search_rows(resolve_missing_dates(page, [row]), "秋招"), [])
        unusable_page = SimpleNamespace()
        self.assertEqual(resolve_missing_dates(unusable_page, [row], deadline=0), [row])
        self.assertEqual(resolve_missing_dates(unusable_page, [row], max_detail_requests=0), [row])

    def test_detail_auth_failure_stops_and_closes_only_detail_page(self):
        row = {"id": "1234", "text": "秋招完整正文", "date": "08月31日 22:57", "url": "https://weibo.com/5678/abc"}
        page, detail = self.fake_search_page(status=403)
        with self.assertRaisesRegex(CollectorError, "HTTP 403"):
            resolve_missing_dates(page, [row])
        self.assertTrue(detail.closed)


if __name__ == "__main__":
    unittest.main()
