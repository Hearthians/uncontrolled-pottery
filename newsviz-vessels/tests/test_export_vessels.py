import unittest
from pathlib import Path
import sys
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
from export_vessels import quantile_sample, unit_score, article_id

class QuantileTests(unittest.TestCase):
    def test_keeps_all_when_small(self):
        rows = [{"id": str(i), "score": i / 10} for i in range(5)]
        self.assertEqual(quantile_sample(rows, 97), sorted(rows, key=lambda r: r["score"]))

    def test_ninety_seven_distinct_including_ends(self):
        rows = [{"id": f"a{i:04d}", "score": i / 999} for i in range(1000)]
        sample = quantile_sample(rows, 97)
        self.assertEqual(len(sample), 97)
        self.assertEqual(len({row["id"] for row in sample}), 97)
        self.assertEqual(sample[0]["score"], 0)
        self.assertEqual(sample[-1]["score"], 999 / 999)

    def test_valence_invert(self):
        self.assertAlmostEqual(unit_score("valence", 10_000), 0.0)  # +1 → 0
        self.assertAlmostEqual(unit_score("valence", -10_000), 1.0)  # -1 → 1
        self.assertAlmostEqual(unit_score("valence", 0), 0.5)
        self.assertAlmostEqual(unit_score("alarmist", 2500), 0.25)
        self.assertEqual(unit_score("angry", 12_000), 1.0)  # clamped

    def test_article_id_from_guardian_url(self):
        url = "https://www.theguardian.com/science/2005/may/22/theobserver.technology"
        self.assertEqual(article_id(url, 0), "science/2005/may/22/theobserver.technology")

if __name__ == "__main__":
    unittest.main()
