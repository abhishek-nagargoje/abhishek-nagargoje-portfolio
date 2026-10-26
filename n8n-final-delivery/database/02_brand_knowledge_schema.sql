-- =====================================================================
-- HR Remedy India - SEO Content Automation
-- 02_brand_knowledge_schema.sql
--
-- Brand RAG knowledge base (pgvector) used by workflow 01 (ingestion) and
-- workflow 02 (retrieval).
--
-- Embedding model : gemini-embedding-001
-- Dimensions      : 768 (explicit outputDimensionality; the model's default
--                   is 3072, which exceeds the 2000-dimension limit of
--                   pgvector HNSW indexes on the "vector" type)
-- Distance        : cosine (vectors are L2-normalised before storage)
--
-- Changing the dimension requires changing vector(768), the CHECK
-- constraints below, and EMBEDDING_DIMENSIONS in both workflows, then
-- re-running ingestion. The workflows refuse to run on a mismatch.
-- =====================================================================

CREATE TABLE IF NOT EXISTS seo_brand_knowledge (
  brand_id             text        NOT NULL,
  knowledge_id         text        NOT NULL,
  category             text        NOT NULL DEFAULT '',
  content              text        NOT NULL,
  source_url           text        NOT NULL DEFAULT '',
  content_hash         char(64)    NOT NULL,
  last_updated         text        NOT NULL DEFAULT '',
  embedding            vector(768) NOT NULL,
  embedding_model      text        NOT NULL,
  embedding_dimensions integer     NOT NULL,
  metadata             jsonb       NOT NULL DEFAULT '{}'::jsonb,
  is_active            boolean     NOT NULL DEFAULT true,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  last_seen_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT seo_brand_knowledge_pk PRIMARY KEY (brand_id, knowledge_id),
  CONSTRAINT seo_brand_knowledge_dims_chk CHECK (embedding_dimensions = 768),
  CONSTRAINT seo_brand_knowledge_content_chk CHECK (length(btrim(content)) > 0),
  CONSTRAINT seo_brand_knowledge_id_chk CHECK (length(btrim(knowledge_id)) > 0)
);

CREATE INDEX IF NOT EXISTS seo_brand_knowledge_embedding_hnsw
  ON seo_brand_knowledge USING hnsw (embedding vector_cosine_ops);

CREATE INDEX IF NOT EXISTS seo_brand_knowledge_active_idx
  ON seo_brand_knowledge (brand_id, embedding_model, is_active);

CREATE INDEX IF NOT EXISTS seo_brand_knowledge_category_idx
  ON seo_brand_knowledge (brand_id, category);

-- One row per ingestion execution (workflow 01 "Log Ingestion Outcome").
CREATE TABLE IF NOT EXISTS seo_brand_ingestion_runs (
  run_id          bigserial PRIMARY KEY,
  brand_id        text        NOT NULL,
  execution_id    text        NOT NULL,
  embedding_model text        NOT NULL,
  status          text        NOT NULL,
  rows_read       integer     NOT NULL DEFAULT 0,
  approved_rows   integer     NOT NULL DEFAULT 0,
  inserted        integer     NOT NULL DEFAULT 0,
  updated         integer     NOT NULL DEFAULT 0,
  unchanged       integer     NOT NULL DEFAULT 0,
  skipped         integer     NOT NULL DEFAULT 0,
  failed          integer     NOT NULL DEFAULT 0,
  deactivated     integer     NOT NULL DEFAULT 0,
  active_records  integer     NOT NULL DEFAULT 0,
  details         jsonb       NOT NULL DEFAULT '{}'::jsonb,
  created_at      timestamptz NOT NULL DEFAULT now()
);

-- Deterministic content hash. Anything that changes the embedded text or
-- the embedding space (category, content, model, dimensions) changes the
-- hash and forces re-embedding. Source_URL is included because it is part
-- of the citation metadata returned with each chunk.
CREATE OR REPLACE FUNCTION seo_knowledge_hash(
  p_category text, p_content text, p_source_url text, p_model text, p_dims integer)
RETURNS text
LANGUAGE sql IMMUTABLE
AS $fn$
  SELECT encode(sha256(convert_to(
           coalesce(btrim(p_category), '') || E'\x1f' ||
           coalesce(btrim(p_content), '')  || E'\x1f' ||
           coalesce(btrim(p_source_url), '') || E'\x1f' ||
           coalesce(p_model, '') || E'\x1f' || coalesce(p_dims::text, ''),
         'UTF8')), 'hex');
$fn$;

-- "Check Content Hash": decides INSERT / UPDATE / UNCHANGED for one record.
-- UNCHANGED rows are re-activated and their last_seen_at refreshed without
-- calling the embedding API again.
CREATE OR REPLACE FUNCTION seo_brand_check(
  p_brand_id text, p_record jsonb, p_model text, p_dims integer)
RETURNS TABLE (action text, knowledge_id text, content_hash text, existing_hash text, record jsonb)
LANGUAGE plpgsql
AS $fn$
#variable_conflict use_column
DECLARE
  v_id   text := btrim(p_record->>'knowledge_id');
  v_hash text := seo_knowledge_hash(p_record->>'category', p_record->>'content',
                                    p_record->>'source_url', p_model, p_dims);
  v_old  text;
BEGIN
  IF v_id IS NULL OR v_id = '' THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: knowledge_id is required';
  END IF;

  SELECT k.content_hash INTO v_old
    FROM seo_brand_knowledge k
   WHERE k.brand_id = p_brand_id AND k.knowledge_id = v_id;

  IF v_old IS NULL THEN
    RETURN QUERY SELECT 'INSERT'::text, v_id, v_hash, NULL::text, p_record;
  ELSIF v_old <> v_hash THEN
    RETURN QUERY SELECT 'UPDATE'::text, v_id, v_hash, v_old, p_record;
  ELSE
    UPDATE seo_brand_knowledge k
       SET is_active = true,
           last_seen_at = now(),
           last_updated = coalesce(p_record->>'last_updated', k.last_updated)
     WHERE k.brand_id = p_brand_id AND k.knowledge_id = v_id;
    RETURN QUERY SELECT 'UNCHANGED'::text, v_id, v_hash, v_old, p_record;
  END IF;
END
$fn$;

-- "Insert or Update Knowledge Record": idempotent upsert keyed on
-- (brand_id, knowledge_id). Returns what was actually stored so the
-- workflow can verify the write.
CREATE OR REPLACE FUNCTION seo_brand_upsert(
  p_brand_id text, p_record jsonb, p_embedding text, p_model text, p_dims integer, p_metadata jsonb)
RETURNS TABLE (action text, knowledge_id text, content_hash text, stored_dimensions integer,
               is_active boolean, updated_at timestamptz)
LANGUAGE plpgsql
AS $fn$
#variable_conflict use_column
DECLARE
  v_id       text := btrim(p_record->>'knowledge_id');
  v_vec      vector;
  v_hash     text;
  v_inserted boolean;
BEGIN
  IF p_dims <> 768 THEN
    RAISE EXCEPTION 'CONFIG_ERROR: workflow requested % dimensions but seo_brand_knowledge.embedding is vector(768)', p_dims;
  END IF;
  v_vec := p_embedding::vector;
  IF vector_dims(v_vec) <> p_dims THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: embedding has % dimensions, expected %', vector_dims(v_vec), p_dims;
  END IF;
  IF coalesce(btrim(p_record->>'content'), '') = '' THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: content is empty for knowledge_id %', v_id;
  END IF;

  v_hash := seo_knowledge_hash(p_record->>'category', p_record->>'content',
                               p_record->>'source_url', p_model, p_dims);

  INSERT INTO seo_brand_knowledge AS k
    (brand_id, knowledge_id, category, content, source_url, content_hash, last_updated,
     embedding, embedding_model, embedding_dimensions, metadata, is_active,
     created_at, updated_at, last_seen_at)
  VALUES
    (p_brand_id, v_id, coalesce(btrim(p_record->>'category'), ''), btrim(p_record->>'content'),
     coalesce(btrim(p_record->>'source_url'), ''), v_hash, coalesce(p_record->>'last_updated', ''),
     v_vec, p_model, p_dims, coalesce(p_metadata, '{}'::jsonb), true, now(), now(), now())
  ON CONFLICT (brand_id, knowledge_id) DO UPDATE
    SET category = EXCLUDED.category,
        content = EXCLUDED.content,
        source_url = EXCLUDED.source_url,
        content_hash = EXCLUDED.content_hash,
        last_updated = EXCLUDED.last_updated,
        embedding = EXCLUDED.embedding,
        embedding_model = EXCLUDED.embedding_model,
        embedding_dimensions = EXCLUDED.embedding_dimensions,
        metadata = EXCLUDED.metadata,
        is_active = true,
        updated_at = now(),
        last_seen_at = now()
  RETURNING (xmax = 0) INTO v_inserted;

  RETURN QUERY
    SELECT CASE WHEN v_inserted THEN 'INSERTED' ELSE 'UPDATED' END,
           k.knowledge_id, k.content_hash::text, vector_dims(k.embedding), k.is_active, k.updated_at
      FROM seo_brand_knowledge k
     WHERE k.brand_id = p_brand_id AND k.knowledge_id = v_id;
END
$fn$;

-- "Log Ingestion Outcome": deactivates records that are no longer approved
-- in the sheet (only when at least one approved record was seen, so an
-- empty or unreadable sheet can never wipe the knowledge base), writes the
-- run log, and returns the resulting active record count.
CREATE OR REPLACE FUNCTION seo_brand_finish_ingestion(
  p_brand_id text, p_execution_id text, p_model text, p_approved_ids jsonb, p_summary jsonb)
RETURNS TABLE (run_id bigint, status text, deactivated integer, active_records integer, total_records integer)
LANGUAGE plpgsql
AS $fn$
#variable_conflict use_column
DECLARE
  v_ids         text[];
  v_deactivated integer := 0;
  v_active      integer;
  v_total       integer;
  v_status      text;
  v_run_id      bigint;
BEGIN
  SELECT coalesce(array_agg(btrim(x)), ARRAY[]::text[])
    INTO v_ids
    FROM jsonb_array_elements_text(coalesce(p_approved_ids, '[]'::jsonb)) AS t(x);

  IF array_length(v_ids, 1) > 0 THEN
    UPDATE seo_brand_knowledge k
       SET is_active = false, updated_at = now()
     WHERE k.brand_id = p_brand_id AND k.is_active AND NOT (k.knowledge_id = ANY (v_ids));
    GET DIAGNOSTICS v_deactivated = ROW_COUNT;
  END IF;

  SELECT count(*) FILTER (WHERE k.is_active AND k.embedding_model = p_model), count(*)
    INTO v_active, v_total
    FROM seo_brand_knowledge k WHERE k.brand_id = p_brand_id;

  v_status := CASE
    WHEN v_active = 0 THEN 'FAILED_EMPTY_KNOWLEDGE_BASE'
    WHEN coalesce((p_summary->>'failed')::int, 0) > 0 THEN 'COMPLETED_WITH_ERRORS'
    ELSE 'COMPLETED' END;

  INSERT INTO seo_brand_ingestion_runs AS r
    (brand_id, execution_id, embedding_model, status, rows_read, approved_rows, inserted, updated,
     unchanged, skipped, failed, deactivated, active_records, details)
  VALUES
    (p_brand_id, p_execution_id, p_model, v_status,
     coalesce((p_summary->>'rows_read')::int, 0), coalesce((p_summary->>'approved_rows')::int, 0),
     coalesce((p_summary->>'inserted')::int, 0), coalesce((p_summary->>'updated')::int, 0),
     coalesce((p_summary->>'unchanged')::int, 0), coalesce((p_summary->>'skipped')::int, 0),
     coalesce((p_summary->>'failed')::int, 0), v_deactivated, v_active, coalesce(p_summary, '{}'::jsonb))
  RETURNING r.run_id INTO v_run_id;

  RETURN QUERY SELECT v_run_id, v_status, v_deactivated, v_active, v_total;
END
$fn$;

-- "Retrieve Relevant Brand Context": cosine similarity search restricted to
-- active records embedded with the same model. Returns a single JSON value
-- so the n8n node emits exactly one item. Records from "always include"
-- categories (e.g. brand voice) are added only if they are not already in
-- the top results, at most two of them, and are labelled as such.
CREATE OR REPLACE FUNCTION seo_brand_retrieve(
  p_brand_id text, p_query_embedding text, p_model text, p_limit integer,
  p_min_similarity double precision, p_always_categories jsonb)
RETURNS jsonb
LANGUAGE plpgsql STABLE
AS $fn$
DECLARE
  v_q        vector := p_query_embedding::vector;
  v_active   integer;
  v_top      jsonb;
  v_always   jsonb;
BEGIN
  IF vector_dims(v_q) <> 768 THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: query embedding has % dimensions, expected 768', vector_dims(v_q);
  END IF;

  SELECT count(*) INTO v_active
    FROM seo_brand_knowledge k
   WHERE k.brand_id = p_brand_id AND k.is_active AND k.embedding_model = p_model;

  SELECT coalesce(jsonb_agg(row_to_json(t)::jsonb ORDER BY t.similarity DESC), '[]'::jsonb)
    INTO v_top
    FROM (
      SELECT k.knowledge_id, k.category, k.content, k.source_url, k.last_updated, k.metadata,
             round((1 - (k.embedding <=> v_q))::numeric, 4)::float8 AS similarity,
             'similarity'::text AS included_reason
        FROM seo_brand_knowledge k
       WHERE k.brand_id = p_brand_id AND k.is_active AND k.embedding_model = p_model
       ORDER BY k.embedding <=> v_q
       LIMIT greatest(1, least(coalesce(p_limit, 8), 50))
    ) t
   WHERE t.similarity >= coalesce(p_min_similarity, 0);

  SELECT coalesce(jsonb_agg(row_to_json(t)::jsonb ORDER BY t.similarity DESC), '[]'::jsonb)
    INTO v_always
    FROM (
      SELECT k.knowledge_id, k.category, k.content, k.source_url, k.last_updated, k.metadata,
             round((1 - (k.embedding <=> v_q))::numeric, 4)::float8 AS similarity,
             'always_include_category'::text AS included_reason
        FROM seo_brand_knowledge k
       WHERE k.brand_id = p_brand_id AND k.is_active AND k.embedding_model = p_model
         AND lower(k.category) IN (SELECT lower(x) FROM jsonb_array_elements_text(coalesce(p_always_categories, '[]'::jsonb)) AS a(x))
         AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_top) e WHERE e->>'knowledge_id' = k.knowledge_id)
       ORDER BY k.embedding <=> v_q
       LIMIT 2
    ) t;

  RETURN jsonb_build_object(
    'active_records', v_active,
    'chunks', v_top || v_always,
    'similarity_matches', jsonb_array_length(v_top),
    'always_included', jsonb_array_length(v_always));
END
$fn$;
