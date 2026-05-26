from __future__ import annotations
import json
import uuid
from datetime import datetime, timezone
from typing import NamedTuple

from app.models.output import BeliefObject
from app.db.schema import get_connection, init_db
from app.db import vectors as vec_store
from app.pipeline.match import BeliefInput, run_matching_pipeline, encode

_initialized = False


def _ensure_init() -> None:
    global _initialized
    if not _initialized:
        init_db()
        _initialized = True


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


class _Provisioned(NamedTuple):
    belief: BeliefObject
    embedding: list[float]
    canonical_id: str
    source_turns: str
    depth_markers_json: str


def persist_beliefs(
    beliefs: list[BeliefObject],
    user_id: str,
    session_first_turn_ts: str | None,
) -> None:
    _ensure_init()
    valid_from = session_first_turn_ts or _now_iso()
    recorded_at = _now_iso()

    # Idempotency: skip if this session was already processed
    conn0 = get_connection()
    try:
        count = conn0.execute(
            "SELECT COUNT(*) FROM belief_events WHERE valid_from = ?", (valid_from,)
        ).fetchone()[0]
    finally:
        conn0.close()
    if count > 0:
        return

    # ── Pass 1: provision ────────────────────────────────────────────────────
    # Assign a provisional canonical_id to every belief, insert into
    # belief_identities + current_beliefs (relations NULL for now), and index
    # vectors. This makes same-session beliefs visible to Stage 4 lookups
    # when Pass 2 runs matching.

    provisioned: list[_Provisioned] = []
    provisional_ids: set[str] = set()

    for b in beliefs:
        embedding = encode(b.belief_text)
        cid = str(uuid.uuid4())
        provisional_ids.add(cid)
        source_turns = json.dumps([e.model_dump() for e in b.source_evidence])
        depth_markers_json = json.dumps(b.depth_markers)

        conn = get_connection()
        try:
            with conn:
                conn.execute(
                    "INSERT INTO belief_identities (id, user_id, created_at) VALUES (?, ?, ?)",
                    (cid, user_id, recorded_at),
                )
                conn.execute(
                    """INSERT INTO current_beliefs (
                        canonical_id, belief_text, subject_tag, self_domain, polarity,
                        claim_commitment, crystallization, affective_charge,
                        belief_state, depth_markers, source_turns,
                        relation_to_prior, related_to_canonical_id,
                        match_confidence, relation_confidence, relation_classifier_flags,
                        valid_from, valid_until, recorded_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL, NULL, NULL, ?, NULL, ?)""",
                    (
                        cid, b.belief_text, b.subject_tag, b.self_domain, b.polarity,
                        b.claim_commitment, b.crystallization, b.affective_charge,
                        b.belief_state, depth_markers_json, source_turns,
                        valid_from, recorded_at,
                    ),
                )
        finally:
            conn.close()

        vec_store.upsert(
            canonical_id=cid,
            embedding=embedding,
            metadata={
                "user_id": user_id,
                "subject_tag": b.subject_tag,
                "self_domain": b.self_domain,
                "polarity": b.polarity,
                "claim_commitment": b.claim_commitment,
                "crystallization": b.crystallization,
            },
            document=b.belief_text,
            subject_tag=b.subject_tag,
        )
        provisioned.append(_Provisioned(b, embedding, cid, source_turns, depth_markers_json))

    # ── Pass 2: match and commit ──────────────────────────────────────────────
    # provisional_to_final tracks absorbed provisionals so the cleanup step can
    # fix dangling related_to_canonical_id pointers.
    provisional_to_final: dict[str, str] = {}

    for prov in provisioned:
        b = prov.belief
        belief_input = BeliefInput(
            belief_text=b.belief_text,
            subject_tag=b.subject_tag,
            self_domain=b.self_domain,
            polarity=b.polarity,
            claim_commitment=b.claim_commitment,
            crystallization=b.crystallization,
        )
        result = run_matching_pipeline(
            belief_input, user_id, embedding=prov.embedding,
            exclude_canonical_ids=[prov.canonical_id],
        )

        # A provisional_id deleted from ChromaDB (absorbed earlier in this loop) won't
        # appear in query results, so is_intra_session only fires for live provisionals.
        is_cross_session = (
            result.canonical_id is not None
            and result.canonical_id not in provisional_ids
        )
        is_intra_session = (
            result.canonical_id is not None
            and result.canonical_id in provisional_ids
        )

        flags_json = (
            json.dumps(result.relation_classifier_flags)
            if result.relation_classifier_flags
            else None
        )

        if is_cross_session:
            # Absorb provisional into the matched prior-session lineage
            final_id = result.canonical_id  # type: ignore[assignment]
            provisional_to_final[prov.canonical_id] = final_id
            related_to_id = None

            conn = get_connection()
            try:
                with conn:
                    conn.execute("DELETE FROM current_beliefs WHERE canonical_id = ?", (prov.canonical_id,))
                    conn.execute("DELETE FROM belief_identities WHERE id = ?", (prov.canonical_id,))
            finally:
                conn.close()
            vec_store.delete(prov.canonical_id)

            # Re-index the prior canonical_id with this belief's fresh embedding
            vec_store.upsert(
                canonical_id=final_id,
                embedding=prov.embedding,
                metadata={
                    "user_id": user_id,
                    "subject_tag": b.subject_tag,
                    "self_domain": b.self_domain,
                    "polarity": b.polarity,
                    "claim_commitment": b.claim_commitment,
                    "crystallization": b.crystallization,
                },
                document=b.belief_text,
                subject_tag=b.subject_tag,
            )

        elif is_intra_session:
            # Related to a sibling from this session — keep own canonical_id, link
            final_id = prov.canonical_id
            related_to_id = result.canonical_id

        else:
            # Pure expansion
            final_id = prov.canonical_id
            related_to_id = None

        event_id = str(uuid.uuid4())
        conn = get_connection()
        try:
            with conn:
                conn.execute(
                    """INSERT INTO belief_events (
                        id, canonical_id, belief_text, subject_tag, self_domain, polarity,
                        claim_commitment, crystallization, affective_charge,
                        belief_state, depth_markers, source_turns,
                        relation_to_prior, related_to_canonical_id,
                        match_confidence, relation_confidence, relation_classifier_flags,
                        valid_from, valid_until, recorded_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                    (
                        event_id, final_id, b.belief_text, b.subject_tag, b.self_domain, b.polarity,
                        b.claim_commitment, b.crystallization, b.affective_charge,
                        b.belief_state, prov.depth_markers_json, prov.source_turns,
                        result.relation_to_prior, related_to_id,
                        result.match_confidence, result.relation_confidence, flags_json,
                        valid_from, None, recorded_at,
                    ),
                )
                conn.execute(
                    """INSERT OR REPLACE INTO current_beliefs (
                        canonical_id, belief_text, subject_tag, self_domain, polarity,
                        claim_commitment, crystallization, affective_charge,
                        belief_state, depth_markers, source_turns,
                        relation_to_prior, related_to_canonical_id,
                        match_confidence, relation_confidence, relation_classifier_flags,
                        valid_from, valid_until, recorded_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                    (
                        final_id, b.belief_text, b.subject_tag, b.self_domain, b.polarity,
                        b.claim_commitment, b.crystallization, b.affective_charge,
                        b.belief_state, prov.depth_markers_json, prov.source_turns,
                        result.relation_to_prior, related_to_id,
                        result.match_confidence, result.relation_confidence, flags_json,
                        valid_from, None, recorded_at,
                    ),
                )
        finally:
            conn.close()

    # ── Cleanup: fix dangling related_to references ───────────────────────────
    # If belief A linked intra-session to provisional B, but B was later absorbed
    # cross-session into final_id, update A's pointer to final_id.
    if provisional_to_final:
        conn = get_connection()
        try:
            with conn:
                for prov_id, final_id in provisional_to_final.items():
                    conn.execute(
                        """UPDATE belief_events
                           SET related_to_canonical_id = ?
                           WHERE related_to_canonical_id = ? AND valid_from = ?""",
                        (final_id, prov_id, valid_from),
                    )
                    conn.execute(
                        """UPDATE current_beliefs
                           SET related_to_canonical_id = ?
                           WHERE related_to_canonical_id = ?""",
                        (final_id, prov_id),
                    )
        finally:
            conn.close()
