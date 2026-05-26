from __future__ import annotations
import json
import uuid
from datetime import datetime, timezone

import numpy as np

from app.db.schema import get_connection
from app.pipeline.match import encode

ASSIGN_THRESHOLD = 0.72
ADJACENCY_THRESHOLD = 0.60


def _cosine(a: list[float], b: list[float]) -> float:
    an = np.array(a, dtype=np.float32)
    bn = np.array(b, dtype=np.float32)
    denom = float(np.linalg.norm(an) * np.linalg.norm(bn))
    if denom == 0.0:
        return 0.0
    return float(np.dot(an, bn) / denom)


def assign_category(subject_tag: str, user_id: str) -> str:
    """Return a category_id for subject_tag, creating a new category if none is close enough."""
    embedding = encode(subject_tag)
    normalized_label = subject_tag.lower().strip()

    conn = get_connection()
    try:
        rows = conn.execute(
            "SELECT id, label, embedding FROM belief_categories WHERE user_id = ?",
            (user_id,),
        ).fetchall()
    finally:
        conn.close()

    existing = [(r["id"], r["label"], json.loads(r["embedding"])) for r in rows]

    best_id: str | None = None
    best_sim = 0.0
    for cat_id, _label, cat_emb in existing:
        sim = _cosine(embedding, cat_emb)
        if sim > best_sim:
            best_sim = sim
            best_id = cat_id

    if best_id is not None and best_sim >= ASSIGN_THRESHOLD:
        return best_id

    now = datetime.now(timezone.utc).isoformat()
    new_id = str(uuid.uuid4())
    emb_json = json.dumps(embedding)

    conn = get_connection()
    try:
        with conn:
            conn.execute(
                "INSERT INTO belief_categories (id, user_id, label, embedding, created_at) VALUES (?, ?, ?, ?, ?)",
                (new_id, user_id, normalized_label, emb_json, now),
            )
    finally:
        conn.close()

    _create_adjacencies(new_id, embedding, existing)
    return new_id


def write_membership(canonical_id: str, category_id: str) -> None:
    conn = get_connection()
    try:
        with conn:
            conn.execute(
                "INSERT OR IGNORE INTO belief_category_memberships (canonical_id, category_id) VALUES (?, ?)",
                (canonical_id, category_id),
            )
    finally:
        conn.close()


def _create_adjacencies(
    new_id: str,
    new_emb: list[float],
    existing: list[tuple[str, str, list[float]]],
) -> None:
    pairs: list[tuple[str, str, float]] = []
    for cat_id, _label, cat_emb in existing:
        sim = _cosine(new_emb, cat_emb)
        if sim >= ADJACENCY_THRESHOLD:
            a, b = (new_id, cat_id) if new_id < cat_id else (cat_id, new_id)
            pairs.append((a, b, sim))

    if not pairs:
        return

    conn = get_connection()
    try:
        with conn:
            for a, b, sim in pairs:
                conn.execute(
                    "INSERT OR IGNORE INTO category_adjacencies (category_id_a, category_id_b, similarity) VALUES (?, ?, ?)",
                    (a, b, sim),
                )
    finally:
        conn.close()
