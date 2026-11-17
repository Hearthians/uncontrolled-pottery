import unittest

from autumn_recruitment.collectors.additional_social import (
    normalize_bluesky_post, normalize_mastodon_status, normalize_reddit_post,
)


class AdditionalPublicSocialTest(unittest.TestCase):
    def mastodon(self, **updates):
        post = {"id": "local-id", "uri": "https://original.example/users/someone/statuses/1",
                "url": "https://original.example/@someone/1?tracking=unused", "content": "<p>I was <strong>laid off</strong>.</p>",
                "created_at": "2024-09-01T00:00:00Z", "edited_at": "2026-11-17T00:00:00Z",
                "reblog": None, "account": {"url": "https://original.example/@someone"}, "language": "en"}
        post.update(updates)
        return post

    def test_mastodon_original_time_and_canonical_identity_across_instances(self):
        first = normalize_mastodon_status(self.mastodon(), "2026 layoffs", source_instance="one.example")
        second = normalize_mastodon_status(self.mastodon(id="another-local-id"), source_instance="two.example")
        self.assertEqual(first["post_id"], second["post_id"])
        self.assertEqual(first["published_at"], "2024-09-01T00:00:00+00:00")
        self.assertEqual(first["text"], "I was laid off.")
        self.assertNotIn("?", first["url"])
        self.assertEqual(first["raw"]["edited_at"], "2026-11-17T00:00:00Z")

    def test_mastodon_does_not_count_boosts_or_guess_missing_original_dates(self):
        self.assertIsNone(normalize_mastodon_status(self.mastodon(reblog={"id": "original"})))
        self.assertIsNone(normalize_mastodon_status(self.mastodon(created_at=None)))
        self.assertIsNone(normalize_mastodon_status(self.mastodon(created_at="2024-09-01T12:00:00")))
        self.assertIsNone(normalize_mastodon_status(self.mastodon(visibility="private")))

    def test_reddit_rejects_news_title_only_and_deleted_body(self):
        base = {"id": "abc", "title": "Job market", "created_utc": 1725148800, "permalink": "/r/cscareerquestions/comments/abc/job_market/"}
        self.assertIsNone(normalize_reddit_post(base))
        self.assertIsNone(normalize_reddit_post({**base, "selftext": "[deleted]"}))
        post = normalize_reddit_post({**base, "selftext": "I am looking for my first role.", "author": "someone"})
        self.assertEqual(post["post_id"], "t3_abc")
        self.assertEqual(post["entry_type"], "post")

    def test_bluesky_original_record_time_and_reply_context(self):
        raw = {"uri": "at://did:plc:example/app.bsky.feed.post/key", "author": {"did": "did:plc:example", "handle": "example.test"},
               "indexedAt": "2026-11-17T00:00:00Z", "record": {"text": "Waiting for graduate hiring.", "createdAt": "2024-09-01T00:00:00Z",
               "langs": ["en"], "reply": {"parent": {"uri": "at://parent"}, "root": {"uri": "at://root"}}}}
        post = normalize_bluesky_post(raw, "2026 job market")
        self.assertEqual(post["published_at"], "2024-09-01T00:00:00+00:00")
        self.assertEqual(post["parent_id"], "at://parent")
        self.assertEqual(post["thread_id"], "at://root")
        self.assertEqual(post["language"], "en")
        raw["record"].pop("createdAt")
        self.assertIsNone(normalize_bluesky_post(raw))
