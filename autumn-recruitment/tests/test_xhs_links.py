import unittest
from autumn_recruitment.collectors.browser import _remember_xhs_link


class XhsDetailLinksTest(unittest.TestCase):
    def test_search_card_link_replaces_seo_alias_for_same_note(self):
        identity = "0123456789abcdef01234567"
        alias = f"https://www.xiaohongshu.com/explore/{identity}"
        actual = f"https://www.xiaohongshu.com/search_result/{identity}?xsec_token=browser-issued&xsec_source=pc_search"
        links = {}
        _remember_xhs_link(links, alias)
        _remember_xhs_link(links, actual)
        _remember_xhs_link(links, alias)
        _remember_xhs_link(links, "https://example.com/explore/" + identity)
        self.assertEqual(links, {identity: actual})


if __name__ == "__main__":
    unittest.main()
