"""SQLite storage for original posts, raw observations, and versioned labels."""

from __future__ import annotations

import hashlib
import json
import sqlite3
from datetime import datetime, timezone
from pathlib import Path
from typing import Iterable

from .config import PLATFORMS


def content_hash(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def _json(value: object) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"), default=str)


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


class Storage:
    def __init__(self, path: str | Path):
        self.path = Path(path).expanduser().resolve()
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.connection = sqlite3.connect(self.path)
        self.connection.row_factory = sqlite3.Row
        self.connection.execute("PRAGMA foreign_keys = ON")
        self.connection.execute("PRAGMA journal_mode = WAL")
        self.connection.executescript("""
            CREATE TABLE IF NOT EXISTS posts (
                platform TEXT NOT NULL,
                post_id TEXT NOT NULL,
                text TEXT NOT NULL,
                published_at TEXT NOT NULL,
                url TEXT NOT NULL DEFAULT '',
                content_hash TEXT NOT NULL,
                payload_json TEXT NOT NULL,
                first_collected_at TEXT NOT NULL,
                last_collected_at TEXT NOT NULL,
                PRIMARY KEY (platform, post_id)
            );
            CREATE TABLE IF NOT EXISTS raw_records (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                platform TEXT NOT NULL,
                post_id TEXT NOT NULL,
                collected_at TEXT NOT NULL,
                raw_hash TEXT NOT NULL,
                record_json TEXT NOT NULL,
                UNIQUE(platform, post_id, raw_hash),
                FOREIGN KEY(platform, post_id) REFERENCES posts(platform, post_id)
            );
            CREATE TABLE IF NOT EXISTS analyses (
                platform TEXT NOT NULL,
                post_id TEXT NOT NULL,
                content_hash TEXT NOT NULL,
                model TEXT NOT NULL,
                prompt_version TEXT NOT NULL,
                analysis_json TEXT NOT NULL,
                created_at TEXT NOT NULL,
                PRIMARY KEY(platform, post_id, content_hash, model, prompt_version),
                FOREIGN KEY(platform, post_id) REFERENCES posts(platform, post_id)
            );
            CREATE INDEX IF NOT EXISTS posts_published_at ON posts(published_at);
        """)

    def __enter__(self) -> "Storage":
        return self

    def __exit__(self, *_: object) -> None:
        self.close()

    def close(self) -> None:
        self.connection.close()

    def upsert_posts(self, posts: Iterable[dict]) -> dict[str, int]:
        """Deduplicate by platform/post ID while retaining distinct raw versions.

        Original post payloads are preserved verbatim apart from normalized ID,
        collection time, and content hash fields. Invalid required fields are
        counted as skipped; no synthetic text or timestamps are introduced.
        """
        counts = {"inserted": 0, "updated": 0, "skipped": 0}
        with self.connection:
            for original in posts:
                post = dict(original)
                if (post.get("platform") not in PLATFORMS or not post.get("post_id")
                        or not isinstance(post.get("text"), str) or not post["text"].strip()
                        or not post.get("published_at")):
                    counts["skipped"] += 1
                    continue
                post["post_id"] = str(post["post_id"])
                post.setdefault("url", "")
                post.setdefault("collected_at", _now())
                post["content_hash"] = content_hash(post["text"])
                existing = self.connection.execute(
                    "SELECT payload_json FROM posts WHERE platform = ? AND post_id = ?",
                    (post["platform"], post["post_id"]),
                ).fetchone()
                if existing is not None and "temporal_review" not in post:
                    previous = json.loads(existing["payload_json"])
                    if "temporal_review" in previous:
                        post["temporal_review"] = previous["temporal_review"]
                self.connection.execute("""
                    INSERT INTO posts(platform, post_id, text, published_at, url, content_hash,
                                      payload_json, first_collected_at, last_collected_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                    ON CONFLICT(platform, post_id) DO UPDATE SET
                        text = excluded.text,
                        published_at = excluded.published_at,
                        url = excluded.url,
                        content_hash = excluded.content_hash,
                        payload_json = excluded.payload_json,
                        last_collected_at = excluded.last_collected_at
                """, (post["platform"], post["post_id"], post["text"], post["published_at"],
                      post["url"], post["content_hash"], _json(post), post["collected_at"],
                      post["collected_at"]))
                # Keep the complete supplied record; changes in counters/text/raw
                # response produce a new record without duplicating identical input.
                raw_record = _json(original)
                self.connection.execute("""
                    INSERT OR IGNORE INTO raw_records(platform, post_id, collected_at, raw_hash, record_json)
                    VALUES (?, ?, ?, ?, ?)
                """, (post["platform"], post["post_id"], post["collected_at"],
                      content_hash(raw_record), raw_record))
                counts["updated" if existing else "inserted"] += 1
        return counts

    def list_posts(self, platform: str | None = None) -> list[dict]:
        sql = "SELECT payload_json FROM posts"
        parameters: tuple = ()
        if platform is not None:
            sql += " WHERE platform = ?"
            parameters = (platform,)
        sql += " ORDER BY platform, published_at, post_id"
        return [json.loads(row["payload_json"]) for row in self.connection.execute(sql, parameters)]

    def save_analysis(self, platform: str, post_id: str, analysis: dict,
                      model: str, prompt_version: str, content_hash: str) -> None:
        with self.connection:
            self.connection.execute("""
                INSERT INTO analyses(platform, post_id, content_hash, model, prompt_version, analysis_json, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(platform, post_id, content_hash, model, prompt_version) DO UPDATE SET
                    analysis_json = excluded.analysis_json,
                    created_at = excluded.created_at
            """, (platform, str(post_id), content_hash, model, prompt_version, _json(analysis), _now()))

    def get_analysis(self, platform: str, post_id: str, content_hash: str,
                     model: str, prompt_version: str) -> dict | None:
        row = self.connection.execute("""
            SELECT analysis_json FROM analyses WHERE platform = ? AND post_id = ?
                AND content_hash = ? AND model = ? AND prompt_version = ?
        """, (platform, str(post_id), content_hash, model, prompt_version)).fetchone()
        return json.loads(row["analysis_json"]) if row else None

    def list_analyses(self) -> list[dict]:
        result = []
        for row in self.connection.execute("SELECT * FROM analyses ORDER BY platform, post_id, created_at"):
            item = dict(row)
            item["analysis"] = json.loads(item.pop("analysis_json"))
            result.append(item)
        return result
