from __future__ import annotations
import os
from typing import Any

import chromadb
from chromadb import Collection

_client: chromadb.ClientAPI | None = None
_collection: Collection | None = None


def _get_client() -> chromadb.ClientAPI:
    global _client
    if _client is None:
        path = os.environ.get("VECTOR_STORE_PATH", "lore_vectors")
        _client = chromadb.PersistentClient(path=path)
    return _client


def get_collection() -> Collection:
    global _collection
    if _collection is None:
        _collection = _get_client().get_or_create_collection(
            name="belief_vectors",
            metadata={"hnsw:space": "cosine"},
        )
    return _collection


def upsert(
    canonical_id: str,
    embedding: list[float],
    metadata: dict[str, Any],
    document: str,
    subject_tag: str = "",
) -> None:
    get_collection().upsert(
        ids=[canonical_id],
        embeddings=[embedding],
        metadatas=[{**metadata, "subject_tag": subject_tag}],
        documents=[document],
    )


def delete(canonical_id: str) -> None:
    try:
        get_collection().delete(ids=[canonical_id])
    except Exception:
        pass


def query(
    embedding: list[float],
    user_id: str,
    self_domain: str,
    n_results: int = 10,
    exclude_ids: list[str] | None = None,
) -> list[dict[str, Any]]:
    collection = get_collection()
    total = collection.count()
    if total == 0:
        return []
    try:
        results = collection.query(
            query_embeddings=[embedding],
            n_results=min(n_results, total),
            where={"user_id": {"$eq": user_id}},
            include=["metadatas", "distances"],
        )
    except Exception:
        return []
    if not results["ids"] or not results["ids"][0]:
        return []
    out = []
    exclude_set = set(exclude_ids or [])
    for i, cid in enumerate(results["ids"][0]):
        if cid in exclude_set:
            continue
        out.append({
            "canonical_id": cid,
            "distance": results["distances"][0][i],
            "metadata": results["metadatas"][0][i],
            "domain_match": results["metadatas"][0][i].get("self_domain") == self_domain,
        })
    return out
