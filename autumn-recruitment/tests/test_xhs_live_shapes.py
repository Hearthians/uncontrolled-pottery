import unittest

from autumn_recruitment.collectors.xiaohongshu import detail_links_from_dom, extract_note_state


class RenderedXhsNotesTests(unittest.TestCase):
    def test_detail_links_ignore_tokenless_seo_links_and_keep_real_card_token(self):
        identity = "6af6b17f000000001f017e90"
        rows = detail_links_from_dom([
            f"https://www.xiaohongshu.com/explore/{identity}",
            f"https://www.xiaohongshu.com/search_result/{identity}?xsec_token=public-card-token",
            f"https://example.com/explore/{identity}?xsec_token=wrong-host",
        ])
        self.assertEqual(list(rows), [identity])
        self.assertIn("xsec_token=public-card-token", rows[identity])

    def test_rendered_camel_case_notes_use_original_time_and_current_id(self):
        state = {"noteDetailMap": {
            "pending": {"note": {}},
            "old": {"note": {"noteId": "old", "title": "旧页", "time": 1725148800000}},
            "current": {"note": {"noteId": "current", "title": "秋招", "desc": "面试好难",
                                  "time": 1725148800000, "lastUpdateTime": 1794844800000,
                                  "user": {"userId": "author"}, "interactInfo": {"likedCount": "12"}}},
        }}
        rows = extract_note_state(state, "25届 秋招", expected_note_id="current")
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["post_id"], "current")
        self.assertEqual(rows[0]["text"], "秋招\n面试好难")
        self.assertTrue(rows[0]["published_at"].startswith("2024-09-01"))
        self.assertEqual(rows[0]["likes"], 12)

    def test_notes_without_original_timestamp_do_not_use_update_time(self):
        state = {"noteDetailMap": {"1": {"note": {"noteId": "1", "title": "秋招", "lastUpdateTime": 1794844800000}}}}
        self.assertEqual(extract_note_state(state), [])
        self.assertEqual(extract_note_state(None), [])


if __name__ == "__main__":
    unittest.main()
