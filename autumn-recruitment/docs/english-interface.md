# English interface

The dashboard uses English for navigation, filters, charts, accessibility labels, status messages, methods and CSV headers. Platform buttons remain sorted by total sample count, with all-platform results first.

Post bodies and verbatim annotation and anxiety evidence retain their original language. Topic and emotion labels have English display names while their stored keys and filter values remain unchanged. Original dataset exports, relevance labels, anxiety scores and evidence are unchanged.

`web/content.en.json` contains 980 English translations: 956 distinct anxiety explanations, 18 limitations, three study names and three descriptions. The explanations were translated from the existing annotations using the configured gateway and `gpt-6.1-sol`. Translation requests contained only the short explanations and study metadata; they did not rescore posts. Coverage, duplicate IDs, Chinese characters in translated values and numeric preservation were checked. Research boundaries and selected explanations were reviewed for meaning.

The browser reads this local catalog alongside the dashboard data. Refreshing, filtering and exporting never call a model. If the catalog cannot load, the page displays an English error and can retry with Refresh. New explanations that are not yet in the catalog are explicitly shown as unavailable in English.

CSV exports contain the same 23 columns and matching records. Headers, categorical labels and explanations use English; `Text`, `Evidence` and `Anxiety evidence` preserve the original source text.

Validation uses the existing browser checks:

```bash
ANXIETY_URL=http://127.0.0.1:8765 \
ANXIETY_OUTPUT_DIR=data/diagnostics/anxiety-web-english \
node scripts/verify-anxiety-web.mjs
```

Deployment includes the three existing static files, `web/content.en.json` and the static-file allowlist in `src/autumn_recruitment/web.py`. Restart the dashboard after installing the updated allowlist. Collection credentials, browser sessions, the database and scoring exports are not part of this update.

Validation passed 19 server tests, 190 complete browser checks, 24 targeted checks and 28 campus-network checks. This includes catalog failure and retry, long labels at narrow widths, original text and evidence preservation, and the complete 957-row CSV. The four deployed static files match the verified source hashes; all five dashboard API responses retain their complete pre-update byte hashes. The deployed page is available at <http://10.7.4.11:8765/>.
