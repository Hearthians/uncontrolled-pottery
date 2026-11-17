import copy
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
from autumn_recruitment.config import PROJECT_ROOT
from autumn_recruitment.llm import validate_labels, content_hash, LLMClient, LLMSettings, load_settings


class LabelsTest(unittest.TestCase):
    def setUp(self):
        self.post = {"platform": "weibo", "post_id": "1", "text": "秋招没有面试，真焦虑", "published_at": "2025-09-01T12:00:00+08:00"}
        self.item = {"id": "weibo:1", "relevant": True, "topics": ["笔试面试"], "sentiment": "negative",
                     "emotions": ["焦虑"], "intensity": 2, "confidence": 0.9, "evidence": ["没有面试"]}

    def test_requires_original_evidence_and_all_ids(self):
        self.assertEqual(validate_labels({"items": [self.item]}, [self.post]), [self.item])
        bad = copy.deepcopy(self.item)
        bad["evidence"] = ["完全编造的引文"]
        with self.assertRaises(ValueError):
            validate_labels({"items": [bad]}, [self.post])
        with self.assertRaises(ValueError):
            validate_labels({"items": []}, [self.post])
        with self.assertRaises(ValueError):
            validate_labels({"items": [self.item, self.item]}, [self.post])

    def test_content_change_invalidates_cache_hash(self):
        self.assertNotEqual(content_hash(self.post), content_hash({**self.post, "text": "秋招拿到 offer 很开心"}))

    def test_credentials_hidden_from_repr(self):
        self.assertNotIn("secret-value", repr(LLMSettings("https://example.com/v1", "model", "secret-value")))

    def test_existing_settings_read_utf8_with_windows_bom(self):
        with tempfile.TemporaryDirectory(prefix="test-settings-", dir=PROJECT_ROOT / "data") as directory:
            config = Path(directory) / "config.toml"
            auth = Path(directory) / "auth.json"
            config.write_text('model = "test-model"\nmodel_provider = "gateway"\n[model_providers.gateway]\nname = "秋招网关"\nbase_url = "https://example.invalid/v1"\nwire_api = "responses"\n', encoding="utf-8-sig")
            auth.write_text(json.dumps({"OPENAI_API_KEY": "fixture-key"}, ensure_ascii=False), encoding="utf-8-sig")
            with patch.dict(os.environ, {"AUTUMN_LLM_CONFIG_FILE": str(config), "AUTUMN_LLM_AUTH_FILE": str(auth)}, clear=True):
                settings = load_settings()
            self.assertEqual((settings.base_url, settings.model, settings.api_key), ("https://example.invalid/v1", "test-model", "fixture-key"))

    def test_responses_payload_and_output(self):
        import json
        client = LLMClient(LLMSettings("https://example.com/v1", "model", "secret"))
        requests = []
        def request(path, payload):
            requests.append((path, payload))
            return {"status": "completed", "output": [{"content": [{"type": "output_text", "text": json.dumps({"items": [self.item]})}]}], "usage": {"total_tokens": 5}}
        client._request = request
        labels, usage = client.analyze([self.post])
        self.assertEqual(labels, [self.item])
        self.assertEqual(requests[0][0], "/responses")
        self.assertFalse(requests[0][1]["store"])
        self.assertEqual(usage["total_tokens"], 5)


if __name__ == "__main__":
    unittest.main()
