-- =============================================================================
-- 02_brand_knowledge_schema.sql
-- Brand knowledge base (RAG) on pgvector.
--
-- Embedding model: gemini-embedding-001 with outputDimensionality = 768.
--   The column type vector(768) MUST equal the dimensionality requested from the
--   embedding API. The ingestion and retrieval workflows both read the expected
--   dimensions from configuration and reject any vector of a different length.
--   To change model or dimensions, follow "Changing the embedding model" in
--   documentation/RAG_SETUP.md (requires re-embedding every chunk).
-- =============================================================================

CREATE TABLE IF NOT EXISTS seo.brands (
  brand_id        text PRIMARY KEY CHECK (brand_id ~ '^[A-Za-z0-9_-]{1,64}$'),
  brand_name      text NOT NULL,
  primary_domain  text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

-- Single-row table recording which embedding model/dimension the stored
-- vectors were produced with. Workflows compare their configuration with this
-- row and stop with a CONFIGURATION error on mismatch (no silent mixing).
CREATE TABLE IF NOT EXISTS seo.embedding_config (
  config_key  text PRIMARY KEY DEFAULT 'active' CHECK (config_key = 'active'),
  model_id    text NOT NULL,
  dimensions  int  NOT NULL CHECK (dimensions BETWEEN 1 AND 16000),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

INSERT INTO seo.embedding_config (config_key, model_id, dimensions)
VALUES ('active', 'gemini-embedding-001', 768)
ON CONFLICT (config_key) DO NOTHING;

CREATE TABLE IF NOT EXISTS seo.brand_knowledge_chunks (
  chunk_id              text PRIMARY KEY,                 -- <brand_id>:<knowledge_id>:<chunk_index>
  brand_id              text NOT NULL REFERENCES seo.brands (brand_id),
  knowledge_id          text NOT NULL,                    -- Knowledge_ID from the source sheet
  chunk_index           int  NOT NULL DEFAULT 0 CHECK (chunk_index >= 0),
  category              text NOT NULL,
  content               text NOT NULL CHECK (length(btrim(content)) > 0),
  source_url            text,
  content_hash          char(64) NOT NULL,                -- sha256 hex of normalized category|content|source_url|model|dims
  source_last_updated   text,                             -- Last_Updated exactly as supplied by the source
  embedding             vector(768) NOT NULL,
  embedding_model       text NOT NULL,
  embedding_dimensions  int  NOT NULL CHECK (embedding_dimensions = 768),
  metadata_json         jsonb NOT NULL DEFAULT '{}'::jsonb,
  is_active             boolean NOT NULL DEFAULT true,
  deactivated_reason    text,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  last_seen_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT brand_knowledge_chunks_identity UNIQUE (brand_id, knowledge_id, chunk_index)
);

-- Cosine-distance HNSW index. Retrieval uses the <=> operator, which matches
-- vector_cosine_ops. Cosine similarity is scale-invariant, so vectors of a
-- reduced dimensionality do not need to be normalised before storage.
CREATE INDEX IF NOT EXISTS brand_knowledge_chunks_embedding_hnsw
  ON seo.brand_knowledge_chunks USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);

CREATE INDEX IF NOT EXISTS brand_knowledge_chunks_brand_category
  ON seo.brand_knowledge_chunks (brand_id, category) WHERE is_active;

CREATE INDEX IF NOT EXISTS brand_knowledge_chunks_brand_knowledge
  ON seo.brand_knowledge_chunks (brand_id, knowledge_id);

-- Ingestion bookkeeping ---------------------------------------------------------
CREATE TABLE IF NOT EXISTS seo.brand_ingestion_runs (
  run_id          bigserial PRIMARY KEY,
  brand_id        text NOT NULL,
  execution_id    text,
  started_at      timestamptz NOT NULL DEFAULT now(),
  finished_at     timestamptz,
  rows_read       int NOT NULL DEFAULT 0,
  rows_approved   int NOT NULL DEFAULT 0,
  rows_invalid    int NOT NULL DEFAULT 0,
  chunks_inserted int NOT NULL DEFAULT 0,
  chunks_updated  int NOT NULL DEFAULT 0,
  chunks_unchanged int NOT NULL DEFAULT 0,
  chunks_deactivated int NOT NULL DEFAULT 0,
  errors          int NOT NULL DEFAULT 0,
  status          text NOT NULL DEFAULT 'RUNNING'
                  CHECK (status IN ('RUNNING', 'SUCCESS', 'PARTIAL', 'FAILED')),
  summary_json    jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE IF NOT EXISTS seo.brand_ingestion_errors (
  error_id      bigserial PRIMARY KEY,
  run_id        bigint REFERENCES seo.brand_ingestion_runs (run_id),
  execution_id  text,
  brand_id      text,
  knowledge_id  text,
  error_class   text NOT NULL,
  message       text NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- -----------------------------------------------------------------------------
-- seo.upsert_brand_chunk
-- Transaction-safe, idempotent upsert of one chunk. All values arrive as bind
-- parameters from n8n; nothing is concatenated into SQL.
-- Returns INSERTED, UPDATED (content/metadata changed or re-activated) or
-- UNCHANGED (identical hash - row only gets last_seen_at refreshed).
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION seo.upsert_brand_chunk(
  p_brand_id            text,
  p_knowledge_id        text,
  p_chunk_index         int,
  p_category            text,
  p_content             text,
  p_source_url          text,
  p_content_hash        text,
  p_source_last_updated text,
  p_embedding           text,     -- pgvector text literal: [0.1,0.2,...]
  p_embedding_model     text,
  p_embedding_dimensions int,
  p_metadata            jsonb
) RETURNS TABLE (chunk_id text, action text)
LANGUAGE plpgsql
AS $$
DECLARE
  v_cfg      seo.embedding_config%ROWTYPE;
  v_chunk_id text := p_brand_id || ':' || p_knowledge_id || ':' || p_chunk_index;
  v_vec      vector;
  v_existing seo.brand_knowledge_chunks%ROWTYPE;
BEGIN
  SELECT * INTO v_cfg FROM seo.embedding_config WHERE config_key = 'active';
  IF v_cfg.model_id IS DISTINCT FROM p_embedding_model OR v_cfg.dimensions IS DISTINCT FROM p_embedding_dimensions THEN
    RAISE EXCEPTION 'EMBEDDING_CONFIG_MISMATCH: database expects % (% dims), workflow sent % (% dims)',
      v_cfg.model_id, v_cfg.dimensions, p_embedding_model, p_embedding_dimensions;
  END IF;

  v_vec := p_embedding::vector;
  IF vector_dims(v_vec) <> v_cfg.dimensions THEN
    RAISE EXCEPTION 'EMBEDDING_DIMENSION_MISMATCH: got % dims, expected %', vector_dims(v_vec), v_cfg.dimensions;
  END IF;

  INSERT INTO seo.brands (brand_id, brand_name)
  VALUES (p_brand_id, p_brand_id)
  ON CONFLICT (brand_id) DO NOTHING;

  SELECT * INTO v_existing FROM seo.brand_knowledge_chunks c WHERE c.chunk_id = v_chunk_id FOR UPDATE;

  IF NOT FOUND THEN
    INSERT INTO seo.brand_knowledge_chunks (
      chunk_id, brand_id, knowledge_id, chunk_index, category, content, source_url,
      content_hash, source_last_updated, embedding, embedding_model, embedding_dimensions, metadata_json)
    VALUES (
      v_chunk_id, p_brand_id, p_knowledge_id, p_chunk_index, p_category, p_content, NULLIF(p_source_url, ''),
      p_content_hash, NULLIF(p_source_last_updated, ''), v_vec, p_embedding_model, p_embedding_dimensions,
      COALESCE(p_metadata, '{}'::jsonb));
    RETURN QUERY SELECT v_chunk_id, 'INSERTED'::text;
    RETURN;
  END IF;

  IF v_existing.content_hash = p_content_hash AND v_existing.is_active THEN
    UPDATE seo.brand_knowledge_chunks c
       SET last_seen_at = now(),
           source_last_updated = NULLIF(p_source_last_updated, '')
     WHERE c.chunk_id = v_chunk_id;
    RETURN QUERY SELECT v_chunk_id, 'UNCHANGED'::text;
    RETURN;
  END IF;

  UPDATE seo.brand_knowledge_chunks c
     SET category = p_category,
         content = p_content,
         source_url = NULLIF(p_source_url, ''),
         content_hash = p_content_hash,
         source_last_updated = NULLIF(p_source_last_updated, ''),
         embedding = v_vec,
         embedding_model = p_embedding_model,
         embedding_dimensions = p_embedding_dimensions,
         metadata_json = COALESCE(p_metadata, '{}'::jsonb),
         is_active = true,
         deactivated_reason = NULL,
         updated_at = now(),
         last_seen_at = now()
   WHERE c.chunk_id = v_chunk_id;
  RETURN QUERY SELECT v_chunk_id, 'UPDATED'::text;
END;
$$;

-- -----------------------------------------------------------------------------
-- seo.deactivate_brand_knowledge
-- Soft-deactivates chunks whose source rows are present but NOT approved, and
-- surplus chunks left over when a long record shrinks to fewer chunks.
-- Nothing is ever deleted; history stays available for audit.
-- p_knowledge_ids: knowledge IDs explicitly unapproved in the source.
-- p_chunk_counts:  {"<knowledge_id>": <current number of chunks>} for approved rows.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION seo.deactivate_brand_knowledge(
  p_brand_id       text,
  p_knowledge_ids  text[],
  p_chunk_counts   jsonb
) RETURNS TABLE (chunk_id text, reason text)
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  WITH unapproved AS (
    UPDATE seo.brand_knowledge_chunks c
       SET is_active = false, deactivated_reason = 'SOURCE_NOT_APPROVED', updated_at = now()
     WHERE c.brand_id = p_brand_id
       AND c.is_active
       AND c.knowledge_id = ANY (COALESCE(p_knowledge_ids, ARRAY[]::text[]))
    RETURNING c.chunk_id, 'SOURCE_NOT_APPROVED'::text AS reason
  ), surplus AS (
    UPDATE seo.brand_knowledge_chunks c
       SET is_active = false, deactivated_reason = 'CHUNK_NO_LONGER_PRESENT', updated_at = now()
      FROM jsonb_each_text(COALESCE(p_chunk_counts, '{}'::jsonb)) AS cnt(knowledge_id, n)
     WHERE c.brand_id = p_brand_id
       AND c.is_active
       AND c.knowledge_id = cnt.knowledge_id
       AND c.chunk_index >= cnt.n::int
    RETURNING c.chunk_id, 'CHUNK_NO_LONGER_PRESENT'::text AS reason
  )
  SELECT * FROM unapproved
  UNION ALL
  SELECT * FROM surplus;
END;
$$;

-- -----------------------------------------------------------------------------
-- seo.match_brand_knowledge
-- Semantic top-K retrieval plus a small number of "pinned" categories (e.g.
-- BRAND_VOICE, APPROVED_CLAIMS, INTERNAL_LINKS) that the writer always needs.
-- Pinned rows are still ranked by similarity and limited per category, so the
-- whole knowledge base is never sent to the model.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION seo.match_brand_knowledge(
  p_brand_id            text,
  p_query_embedding     text,
  p_top_k               int,
  p_min_similarity      double precision,
  p_pinned_categories   text[],
  p_pinned_per_category int
) RETURNS TABLE (
  chunk_id         text,
  knowledge_id     text,
  category         text,
  content          text,
  source_url       text,
  similarity       double precision,
  retrieval_reason text,
  source_last_updated text,
  metadata_json    jsonb
)
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  v_cfg seo.embedding_config%ROWTYPE;
  v_q   vector;
BEGIN
  SELECT * INTO v_cfg FROM seo.embedding_config WHERE config_key = 'active';
  v_q := p_query_embedding::vector;
  IF vector_dims(v_q) <> v_cfg.dimensions THEN
    RAISE EXCEPTION 'EMBEDDING_DIMENSION_MISMATCH: query has % dims, index expects %', vector_dims(v_q), v_cfg.dimensions;
  END IF;

  RETURN QUERY
  WITH semantic AS (
    SELECT c.chunk_id, c.knowledge_id, c.category, c.content, c.source_url,
           1 - (c.embedding <=> v_q) AS similarity,
           'SEMANTIC_TOP_K'::text AS retrieval_reason,
           c.source_last_updated, c.metadata_json
      FROM seo.brand_knowledge_chunks c
     WHERE c.brand_id = p_brand_id AND c.is_active
     ORDER BY c.embedding <=> v_q
     LIMIT GREATEST(LEAST(p_top_k, 50), 1)
  ), pinned AS (
    SELECT ranked.chunk_id, ranked.knowledge_id, ranked.category, ranked.content, ranked.source_url,
           ranked.similarity, 'PINNED_CATEGORY'::text, ranked.source_last_updated, ranked.metadata_json
      FROM (
        SELECT c.*, 1 - (c.embedding <=> v_q) AS similarity,
               row_number() OVER (PARTITION BY c.category ORDER BY c.embedding <=> v_q) AS rn
          FROM seo.brand_knowledge_chunks c
         WHERE c.brand_id = p_brand_id AND c.is_active
           AND c.category = ANY (COALESCE(p_pinned_categories, ARRAY[]::text[]))
      ) ranked
     WHERE ranked.rn <= GREATEST(LEAST(p_pinned_per_category, 10), 0)
  ), combined AS (
    SELECT * FROM semantic s WHERE s.similarity >= p_min_similarity
    UNION ALL
    SELECT * FROM pinned
  )
  SELECT DISTINCT ON (combined.chunk_id)
         combined.chunk_id, combined.knowledge_id, combined.category, combined.content, combined.source_url,
         combined.similarity, combined.retrieval_reason, combined.source_last_updated, combined.metadata_json
    FROM combined
   ORDER BY combined.chunk_id, combined.retrieval_reason DESC;  -- prefer SEMANTIC_TOP_K label when both
END;
$$;

INSERT INTO seo.schema_migrations (version, description)
VALUES ('02', 'brand knowledge chunks, ingestion log, retrieval function')
ON CONFLICT (version) DO NOTHING;
