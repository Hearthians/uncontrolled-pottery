# Private study data

This directory holds the SQLite database, raw platform responses, optional browser
profiles/cookies, and any local credential references. Its contents are ignored by
Git except for this file. Store exported tables and reports in `../outputs/`,
which is also ignored. Do not commit API keys, cookies, or collected post text.

`study.sqlite3` stores original posts separately from cached model labels. The
sampling target is 200 posts per platform across all configured calendar years;
the actual result can be smaller when matching historical posts are unavailable.
Search results are a convenience sample, not an estimate of the entire market.
