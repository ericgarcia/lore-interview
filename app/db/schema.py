from __future__ import annotations
import os
import sqlite3

_SCHEMA = """
CREATE TABLE IF NOT EXISTS evaluation_cache (
  source_id     TEXT PRIMARY KEY,
  response_json TEXT NOT NULL,
  cached_at     TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS belief_identities (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS belief_events (
  id                        TEXT PRIMARY KEY,
  canonical_id              TEXT NOT NULL REFERENCES belief_identities(id),
  belief_text               TEXT NOT NULL,
  subject_tag               TEXT NOT NULL DEFAULT '',
  self_domain               TEXT NOT NULL,
  polarity                  TEXT NOT NULL,
  claim_commitment          REAL NOT NULL,
  crystallization           REAL NOT NULL,
  affective_charge          TEXT,
  belief_state              TEXT NOT NULL,
  depth_markers             TEXT NOT NULL DEFAULT '[]',
  source_turns              TEXT NOT NULL,

  relation_to_prior         TEXT,
  related_to_canonical_id   TEXT REFERENCES belief_identities(id),
  match_confidence          REAL,
  relation_confidence       REAL,
  relation_classifier_flags TEXT,

  valid_from                TEXT NOT NULL,
  valid_until               TEXT,
  recorded_at               TEXT NOT NULL,

  CONSTRAINT match_confidence_range
    CHECK (match_confidence IS NULL OR (match_confidence >= 0 AND match_confidence <= 1)),
  CONSTRAINT relation_confidence_range
    CHECK (relation_confidence IS NULL OR (relation_confidence >= 0 AND relation_confidence <= 1)),
  CONSTRAINT relation_requires_match_confidence
    CHECK (relation_to_prior IS NULL OR match_confidence IS NOT NULL),
  CONSTRAINT relation_confidence_requires_relation
    CHECK (relation_confidence IS NULL OR relation_to_prior IS NOT NULL),
  CONSTRAINT related_canonical_requires_relation
    CHECK (related_to_canonical_id IS NULL OR relation_to_prior IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_belief_events_canonical
  ON belief_events (canonical_id, valid_from);

CREATE INDEX IF NOT EXISTS idx_belief_events_low_match_confidence
  ON belief_events (canonical_id, valid_from)
  WHERE match_confidence < 0.80;

CREATE INDEX IF NOT EXISTS idx_belief_events_low_relation_confidence
  ON belief_events (canonical_id, valid_from)
  WHERE relation_confidence < 0.80;

CREATE INDEX IF NOT EXISTS idx_belief_events_related_canonical
  ON belief_events (related_to_canonical_id, valid_from)
  WHERE related_to_canonical_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS rejected_beliefs (
  id              TEXT PRIMARY KEY,
  source_id       TEXT NOT NULL,
  evaluation_id   TEXT NOT NULL,
  rejection_reason TEXT NOT NULL,
  belief_text     TEXT NOT NULL,
  belief_type     TEXT NOT NULL,
  subject_tag     TEXT NOT NULL DEFAULT '',
  self_domain     TEXT NOT NULL,
  polarity        TEXT NOT NULL,
  claim_commitment REAL NOT NULL,
  crystallization  REAL NOT NULL,
  affective_charge TEXT,
  evidence_spans  TEXT NOT NULL DEFAULT '[]',
  depth_markers   TEXT NOT NULL DEFAULT '[]',
  nli_premise     TEXT,
  nli_score       REAL,
  nli_threshold   REAL,
  recorded_at     TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_rejected_beliefs_source_id
  ON rejected_beliefs (source_id);

CREATE TABLE IF NOT EXISTS evaluation_metrics (
  id                        TEXT PRIMARY KEY,
  source_type               TEXT NOT NULL,
  ref_user_id               INTEGER NOT NULL,
  evaluated_at              TEXT NOT NULL,

  total_latency_ms          INTEGER,
  preprocess_ms             INTEGER,
  extract_ms                INTEGER,
  verify_ms                 INTEGER,
  aggregate_ms              INTEGER,
  persist_ms                INTEGER,

  llm_tokens_in             INTEGER,
  llm_tokens_out            INTEGER,
  llm_call_count            INTEGER,
  llm_retry_count           INTEGER,

  turn_count                INTEGER,
  chunk_count               INTEGER,
  viable                    INTEGER,

  beliefs_extracted         INTEGER,
  beliefs_verified          INTEGER,
  beliefs_deduplicated      INTEGER,
  beliefs_final             INTEGER,
  nli_rejection_rate        REAL,
  richness_score            REAL,

  nli_confidence_stats      TEXT,
  commitment_stats          TEXT,
  crystallization_stats     TEXT,
  beliefs_by_domain         TEXT,
  beliefs_by_polarity       TEXT,
  beliefs_by_affective_charge TEXT,
  beliefs_by_delta          TEXT,
  beliefs_by_state          TEXT,
  explicit_belief_count     INTEGER,
  implicit_belief_count     INTEGER
);

CREATE INDEX IF NOT EXISTS idx_evaluation_metrics_evaluated_at
  ON evaluation_metrics (evaluated_at DESC);

CREATE TABLE IF NOT EXISTS current_beliefs (
  canonical_id              TEXT PRIMARY KEY REFERENCES belief_identities(id),
  belief_text               TEXT NOT NULL,
  subject_tag               TEXT NOT NULL DEFAULT '',
  self_domain               TEXT NOT NULL,
  polarity                  TEXT NOT NULL,
  claim_commitment          REAL NOT NULL,
  crystallization           REAL NOT NULL,
  affective_charge          TEXT,
  belief_state              TEXT NOT NULL,
  depth_markers             TEXT NOT NULL DEFAULT '[]',
  source_turns              TEXT NOT NULL,
  relation_to_prior         TEXT,
  related_to_canonical_id   TEXT,
  match_confidence          REAL,
  relation_confidence       REAL,
  relation_classifier_flags TEXT,
  valid_from                TEXT NOT NULL,
  valid_until               TEXT,
  recorded_at               TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS belief_categories (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL,
  label      TEXT NOT NULL,
  embedding  TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_belief_categories_user
  ON belief_categories (user_id);

CREATE TABLE IF NOT EXISTS belief_category_memberships (
  canonical_id TEXT NOT NULL REFERENCES belief_identities(id),
  category_id  TEXT NOT NULL REFERENCES belief_categories(id),
  PRIMARY KEY (canonical_id, category_id)
);

CREATE INDEX IF NOT EXISTS idx_memberships_category
  ON belief_category_memberships (category_id);

CREATE TABLE IF NOT EXISTS category_adjacencies (
  category_id_a TEXT NOT NULL REFERENCES belief_categories(id),
  category_id_b TEXT NOT NULL REFERENCES belief_categories(id),
  similarity    REAL NOT NULL,
  PRIMARY KEY (category_id_a, category_id_b),
  CHECK (category_id_a < category_id_b)
);
"""


def get_db_path() -> str:
    return os.environ.get("DB_PATH", "lore.db")


def get_connection(db_path: str | None = None) -> sqlite3.Connection:
    path = db_path or get_db_path()
    conn = sqlite3.connect(path)
    conn.execute("PRAGMA foreign_keys = ON")
    conn.row_factory = sqlite3.Row
    return conn


_MIGRATIONS = [
    "ALTER TABLE belief_events ADD COLUMN subject_tag TEXT NOT NULL DEFAULT ''",
    "ALTER TABLE current_beliefs ADD COLUMN subject_tag TEXT NOT NULL DEFAULT ''",
    "ALTER TABLE rejected_beliefs ADD COLUMN nli_premise TEXT",
]


def init_db(db_path: str | None = None) -> None:
    conn = get_connection(db_path)
    try:
        conn.executescript(_SCHEMA)
        for sql in _MIGRATIONS:
            try:
                conn.execute(sql)
            except Exception:
                pass  # column already exists
        conn.commit()
    finally:
        conn.close()
