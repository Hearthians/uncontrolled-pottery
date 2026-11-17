"""Offline end-to-end tests: synthetic inputs stay in a cleaned project subdir."""
from __future__ import annotations

import copy
import csv
from contextlib import redirect_stderr, redirect_stdout
import io
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from autumn_recruitment import cli
from autumn_recruitment.config import PROJECT_ROOT, load_config
from autumn_recruitment.llm import LLMSettings, PROMPT_VERSION, content_hash
from autumn_recruitment.storage import Storage


def decode_emissions(text: str) -> list[dict]:
    decoder = json.JSONDecoder()
    values = []
    remaining = text.lstrip()
    while remaining:
        value, consumed = decoder.raw_decode(remaining)
        values.append(value)
        remaining = remaining[consumed:].lstrip()
    return values


def label(post: dict, *, stale: bool = False) -> dict:
    relevant = post["post_id"] != "irrelevant"
    return {
        "id": f"{post['platform']}:{post['post_id']}",
        "relevant": relevant,
        "topics": ["行业前景"] if stale else ["笔试面试"] if relevant else [],
        "sentiment": "negative" if relevant else "neutral",
        "emotions": ["焦虑"] if relevant else [],
        "intensity": 2 if relevant else 0,
        "confidence": 0.9,
        "evidence": ["秋招"] if relevant else [],
    }


class CliIntegrationTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix="test-cli-", dir=PROJECT_ROOT / "data")
        self.directory = Path(self.temporary.name)
        settings = copy.deepcopy(load_config())
        settings["years"] = [2025, 2026]
        settings["target_per_platform"] = 4
        for name, platform in settings["platforms"].items():
            platform["enabled"] = name == "weibo"
        relative = self.directory.relative_to(PROJECT_ROOT)
        settings["storage"] = {"database": str(relative / "study.sqlite3"),
                               "raw_dir": str(relative / "raw"), "output_dir": str(relative / "outputs")}
        self.config_path = self.directory / "config.json"
        self.config_path.write_text(json.dumps(settings, ensure_ascii=False), encoding="utf-8")
        self.config = load_config(self.config_path)
        self.source = self.directory / "synthetic.jsonl"
        posts = [
            {"post_id": "negative", "text": "=秋招面试一直没有回复，我很焦虑", "published_at": "2025-09-01T10:00:00+08:00"},
            {"post_id": "irrelevant", "text": "秋招只是我家猫的名字，今天又在面试官旁边睡觉", "published_at": "2025-09-02T10:00:00+08:00"},
            {"post_id": "changed", "text": "2027届秋招面试还在等待，担心没有结果", "published_at": "2026-09-01T10:00:00+08:00"},
            {"post_id": "cached", "text": "秋招面试的进度终于有了更新", "published_at": "2026-09-02T10:00:00+08:00"},
            {"post_id": "old", "text": "秋招面试情况不好，这是往年的记录", "published_at": "2021-09-01T10:00:00+08:00"},
            {"post_id": "outside-window", "text": "秋招面试还没有结束，已经到十二月", "published_at": "2026-12-01T10:00:00+08:00"},
            {"post_id": "ad", "text": "秋招面试课程报名，现在购买限时优惠", "published_at": "2026-09-01T10:00:00+08:00"},
            {"post_id": "unrelated", "text": "今天午饭味道不错，天气也很好", "published_at": "2026-09-01T10:00:00+08:00"},
        ]
        self.source.write_text("".join(json.dumps(post, ensure_ascii=False) + "\n" for post in posts), encoding="utf-8")
        self.llm_settings = LLMSettings("https://example.invalid/v1", "offline-test-model", "not-a-real-key")

    def tearDown(self):
        self.temporary.cleanup()

    def run_cli(self, *arguments: str) -> tuple[int, list[dict], str]:
        stdout, stderr = io.StringIO(), io.StringIO()
        with redirect_stdout(stdout), redirect_stderr(stderr):
            code = cli.main(["--config", str(self.config_path), *arguments])
        return code, decode_emissions(stdout.getvalue()), stderr.getvalue()

    def test_import_sample_cached_analysis_and_export(self):
        code, results, errors = self.run_cli("import", str(self.source), "--platform", "weibo")
        self.assertEqual((code, errors), (0, ""))
        self.assertEqual(results[-1]["imported"]["inserted"], 8)
        code, results, errors = self.run_cli("sample")
        self.assertEqual((code, errors), (0, ""))
        self.assertEqual(results[-1]["selected"], 4)
        self.assertEqual([group["selected"] for group in results[-1]["groups"]], [2, 2])
        self.assertEqual([group["shortfall"] for group in results[-1]["groups"]], [0, 0])

        with Storage(self.config["db_path"]) as store:
            original_posts = {post["post_id"]: post for post in store.list_posts()}
            samples = {post["post_id"]: post for post in cli.selected_posts(store, self.config)}
            for identifier, model, version, digest in [
                ("negative", self.llm_settings.model, "old-prompt", content_hash(samples["negative"])),
                ("irrelevant", "different-model", PROMPT_VERSION, content_hash(samples["irrelevant"])),
                ("changed", self.llm_settings.model, PROMPT_VERSION, "old-content-hash"),
                ("cached", self.llm_settings.model, PROMPT_VERSION, content_hash(samples["cached"])),
                ("old", self.llm_settings.model, PROMPT_VERSION, content_hash(original_posts["old"])),
            ]:
                post = original_posts[identifier]
                store.save_analysis("weibo", identifier, label(post, stale=identifier != "cached"), model, version, digest)
        analysed = []

        def fake_analyze(batch):
            analysed.extend(post["post_id"] for post in batch)
            return [label(post) for post in batch], {"total_tokens": 0}

        with patch.object(cli, "load_settings", return_value=self.llm_settings), patch.object(cli, "LLMClient") as client:
            client.return_value.analyze.side_effect = fake_analyze
            code, results, errors = self.run_cli("analyze", "--limit", "2", "--batch-size", "1")
            self.assertEqual((code, errors), (0, ""))
            self.assertEqual(results[-1]["analysed_this_run"], 2)
            self.assertEqual(results[-1]["cached"], 1)
            code, results, errors = self.run_cli("analyze")
            self.assertEqual((code, errors), (0, ""))
            self.assertEqual(results[-1]["analysed_this_run"], 1)
            self.assertEqual(results[-1]["cached"], 3)
            code, results, errors = self.run_cli("analyze")
            self.assertEqual((code, errors), (0, ""))
            self.assertEqual(results[-1]["analysed_this_run"], 0)
            self.assertEqual(results[-1]["cached"], 4)
            self.assertCountEqual(analysed, ["negative", "irrelevant", "changed"])
            code, results, errors = self.run_cli("export")
            self.assertEqual((code, errors), (0, ""))
            self.assertEqual(results[-1]["labelled"], 4)

        output = Path(self.config["output_dir"])
        summary = json.loads((output / "summary.json").read_text(encoding="utf-8"))
        self.assertEqual((summary["selected"], summary["labelled"]), (4, 4))
        self.assertEqual([group["relevant"] for group in summary["groups"]], [1, 2])
        self.assertEqual(summary["groups"][0]["sentiments"], {"negative": 1})
        self.assertEqual(summary["groups"][1]["topics"], {"笔试面试": 2})
        exported = [json.loads(line) for line in (output / "sample.jsonl").read_text(encoding="utf-8").splitlines()]
        self.assertEqual({post["post_id"] for post in exported}, {"negative", "irrelevant", "changed", "cached"})
        cohort_post = next(post for post in exported if post["post_id"] == "changed")
        self.assertEqual((cohort_post["season_year"], cohort_post["graduation_cohort"]), (2026, 2027))
        with (output / "labels.csv").open(encoding="utf-8-sig", newline="") as handle:
            csv_rows = list(csv.DictReader(handle))
        self.assertTrue(next(row["text"] for row in csv_rows if row["post_id"] == "negative").startswith("'="))
        self.assertTrue((output / "report.md").is_file())

    def test_zero_batch_size_is_rejected_before_loading_credentials(self):
        with patch.object(cli, "load_settings") as load:
            code, _, errors = self.run_cli("analyze", "--batch-size", "0")
        self.assertEqual(code, 1)
        self.assertIn("batch-size", errors)
        load.assert_not_called()

    def test_module_entrypoint_can_show_plan_without_credentials(self):
        result = subprocess.run([sys.executable, "-m", "autumn_recruitment", "--config", str(self.config_path), "plan"],
                                cwd=PROJECT_ROOT, env={**os.environ, "PYTHONPATH": str(PROJECT_ROOT / "src"), "PYTHONUTF8": "1"},
                                capture_output=True, text=True, encoding="utf-8", check=False)
        self.assertEqual(result.returncode, 0, result.stderr)
        plan = json.loads(result.stdout)
        self.assertEqual(sum(job["quota"] for job in plan["jobs"]), 4)


if __name__ == "__main__":
    unittest.main()
