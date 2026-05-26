#!/usr/bin/env python3
"""Seed SQLite with raw conversation and discussion turns from data/*.json.

Usage:
    python scripts/seed_db.py [--data-dir data/] [--db lore.db]

Idempotent — uses INSERT OR IGNORE, safe to re-run after adding new files.
"""
from __future__ import annotations

import argparse
import json
import os
import sys

# Allow running from project root without installing the package
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from dotenv import load_dotenv
load_dotenv()

from app.db.schema import init_db, get_connection

DISC_FILES = ["discussions.json"]

# Sentinel stored in DB for discussion_turns where comment_id IS NULL (original post).
_NULL_COMMENT_SENTINEL = -1


def _conversation_files(data_dir: str) -> list[str]:
    """Return all conversation JSON files: fixed names + any simulated_*.json files."""
    fixed = ["conversations.json", "conversations2.json"]
    import glob
    simulated = sorted(glob.glob(os.path.join(data_dir, "simulated_*.json")))
    return [os.path.join(data_dir, f) for f in fixed] + simulated


def seed_conversations(conn, data_dir: str) -> int:
    count = 0
    for filepath in _conversation_files(data_dir):
        if not os.path.exists(filepath):
            continue
        with open(filepath) as f:
            convs = json.load(f)
        for conv in (convs if isinstance(convs, list) else [convs]):
            cid = conv["ref_conversation_id"]
            uid = conv["ref_user_id"]
            for idx, msg in enumerate(conv["messages_list"]):
                conn.execute(
                    """INSERT OR IGNORE INTO conversation_turns
                       (ref_conversation_id, conv_user_id, turn_index,
                        author_ref_user_id, screen_name, message, transaction_datetime_utc)
                       VALUES (?, ?, ?, ?, ?, ?, ?)""",
                    (
                        cid, uid, idx,
                        msg["ref_user_id"], msg["screen_name"],
                        msg["message"], msg["transaction_datetime_utc"],
                    ),
                )
                count += 1
    return count


def seed_discussions(conn, data_dir: str) -> int:
    count = 0
    for filename in DISC_FILES:
        filepath = os.path.join(data_dir, filename)
        if not os.path.exists(filepath):
            continue
        with open(filepath) as f:
            discs = json.load(f)
        for disc in discs:
            for msg in disc["messages_list"]:
                comment_id = msg.get("comment_id")
                stored_comment_id = _NULL_COMMENT_SENTINEL if comment_id is None else comment_id
                conn.execute(
                    """INSERT OR IGNORE INTO discussion_turns
                       (post_id, comment_id, author_ref_user_id, body, reported_or_removed)
                       VALUES (?, ?, ?, ?, ?)""",
                    (
                        msg["post_id"], stored_comment_id,
                        msg["author_ref_user_id"], msg["text"],
                        int(msg.get("reported_or_removed", False)),
                    ),
                )
                count += 1
    return count


def main() -> None:
    parser = argparse.ArgumentParser(description="Seed DB from JSON data files")
    parser.add_argument("--data-dir", default="data", help="Path to data directory")
    parser.add_argument("--db", default=None, help="Path to SQLite DB (default: $DB_PATH or lore.db)")
    args = parser.parse_args()

    init_db(args.db)
    conn = get_connection(args.db)

    try:
        conv_count = seed_conversations(conn, args.data_dir)
        disc_count = seed_discussions(conn, args.data_dir)
        conn.commit()
    finally:
        conn.close()

    print(f"Seeded {conv_count} conversation turns, {disc_count} discussion turns")


if __name__ == "__main__":
    main()
