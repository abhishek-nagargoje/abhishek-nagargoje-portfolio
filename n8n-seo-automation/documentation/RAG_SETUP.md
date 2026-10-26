# Brand knowledge RAG (PostgreSQL + pgvector)

## Components

| Part | Where |
|---|---|
| Source of truth | Google Sheets tab `Brand_Knowledge` (`Approved = TRUE` rows only) |
| Ingestion | `workflows/01_Brand_RAG_Ingestion.json` (manual + daily 07:30 IST) |
| Store | `seo.brand_knowledge_chunks` with `embedding vector(768)`, HNSW cosine index |
| Upsert | `seo.upsert_brand_chunk()`: transaction-safe, hash-based, parameterized |
| Retrieval | `seo.match_brand_knowledge()`: semantic top-K + pinned categories |
| Run log | `seo.brand_ingestion_runs`, `seo.brand_ingestion_errors` |

## Database setup

```bash
psql -v ON_ERROR_STOP=1 -h <host> -U <admin> -d <db> -f database/01_pgvector_setup.sql
psql -v ON_ERROR_STOP=1 -h <host> -U <admin> -d <db> -f database/02_brand_knowledge_schema.sql
psql -v ON_ERROR_STOP=1 -h <host> -U <admin> -d <db> -f database/03_article_processing_history.sql
psql -v ON_ERROR_STOP=1 -h <host> -U <admin> -d <db> -f database/04_idempotency_and_recovery.sql
psql -h <host> -U <admin> -d <db> -c '\password n8n_seo_app'
```

The scripts are idempotent, and re-running them is the upgrade path. They
were tested twice in a row on PostgreSQL 16.15 with pgvector 0.6.0. They
require pgvector 0.5.0+ for HNSW. The `pgvector/pgvector:pg16` Docker image is
the simplest option on the VPS.

## Ingestion behaviour

1. Read `Brand_Knowledge`. The run fails with a clear message if required
   columns are missing.
2. Rows that are not `Approved` are never embedded. If they were ingested
   earlier, their chunks are **soft-deactivated** (`is_active = false`,
   `deactivated_reason = 'SOURCE_NOT_APPROVED'`). Nothing is deleted.
3. Validate: unique `Knowledge_ID`, allowed category, content ≥ 20 characters
   and not a template placeholder, valid `Source_URL`. Invalid rows are logged
   in `seo.brand_ingestion_errors` and never silently dropped.
4. Normalise text: Unicode NFKC, control characters removed, whitespace
   collapsed. Long content is split at paragraph boundaries into ≤ 3,000
   character chunks. Chunk ID = `<BRAND_ID>:<Knowledge_ID>:<index>`.
5. SHA-256 (n8n Crypto node) over category + content + source URL + embedding
   model + dimensions. **Unchanged chunks are not re-embedded.** Changing the
   model or dimensions changes the hash, which forces re-embedding.
6. Embed new/changed chunks: 5 per second, 3 retries, `RETRIEVAL_DOCUMENT`.
   Each response is validated (exactly 768 finite numbers).
7. `seo.upsert_brand_chunk()` returns INSERTED / UPDATED / UNCHANGED. Surplus
   chunks of a record that got shorter are deactivated.
8. `Finalize Ingestion Run` writes the counts. The run is `SUCCESS`, `PARTIAL`
   (some errors), or `FAILED`, which raises an error so it is visible in n8n and
   the Error Recovery workflow.

Tested end to end: the first run embedded 6 approved chunks and rejected 1
invalid row. A re-run made **0** embedding calls. A changed row was re-embedded,
and a row set to `Approved = FALSE` was deactivated (`tests/results/e2e_results.json`, I1–I3).

## Retrieval used by the article workflow

* Query text = primary keyword + supporting keywords + intent + audience +
  location + target-page title/H1/meta/H2s + a page-content excerpt. It is
  embedded with `RETRIEVAL_QUERY`, using the same model and dimensions.
* `seo.match_brand_knowledge(brand, vector, RAG_TOP_K=6, RAG_MIN_SIMILARITY=0.55,
  pinned categories, 2 per category)`.
* **Sufficiency gate:** at least `RAG_MIN_RELEVANT_CHUNKS` (2) semantic results
  must meet the similarity threshold. Otherwise the record goes to
  `REVIEW_REQUIRED` (`INSUFFICIENT_BRAND_CONTEXT`) and Gemini is never asked to
  write.
* The **original chunks** (Knowledge_ID, category, content, source,
  similarity) go to the prompt creator, the writer, the evaluator and the
  reviser, not just a summary.
* Verified internal links = target page + links found on the target page +
  same-site URLs in brand knowledge. Any other internal URL in an article is
  rejected.

### Tuning

Inspect what retrieval returns for a real keyword:

```sql
-- paste a query vector from an execution, or test category coverage:
SELECT category, count(*) FROM seo.brand_knowledge_chunks WHERE brand_id='KARGAR' AND is_active GROUP BY 1;
```

* Too many REVIEW_REQUIRED for in-scope topics: add approved knowledge for
  those topics, or lower `RAG_MIN_SIMILARITY` gradually (0.50, then 0.45).
  Do not go lower before reviewing the retrieved chunks in executions.
* Irrelevant chunks retrieved: raise the threshold or reduce `RAG_TOP_K`
  (start with 5–8).
* Volumes up to tens of thousands of chunks are fine with HNSW
  (`m=16, ef_construction=64`). Retrieval filters by `brand_id`; for many brands
  with large data consider partial indexes per brand.

## Adding another brand

Use a separate `Brand_Knowledge` spreadsheet (or tab), and a copy of workflow 01
and of the configuration in 02 with a different `BRAND_ID`, `BRAND_NAMES` and
sheet IDs. All data is keyed by `brand_id`; the schema needs no change.

## Changing the embedding model

Vectors from different models or dimensions must never be mixed. *This
migration procedure is documented but was **not** executed by the test suite.
Run it on a copy of the database first.*

1. Pause the article workflow.
2. Choose the new model and dimensions. Read its documentation for supported
   `outputDimensionality` values and task types. `gemini-embedding-2` batches
   differently: one embedding per Content object.
3. In SQL (admin), in a maintenance window:
   ```sql
   BEGIN;
   UPDATE seo.embedding_config SET model_id = '<new-model>', dimensions = <N>, updated_at = now();
   DROP INDEX seo.brand_knowledge_chunks_embedding_hnsw;
   ALTER TABLE seo.brand_knowledge_chunks DROP CONSTRAINT IF EXISTS brand_knowledge_chunks_embedding_dimensions_check;
   ALTER TABLE seo.brand_knowledge_chunks ALTER COLUMN embedding TYPE vector(<N>) USING NULL;  -- old vectors are invalid
   ALTER TABLE seo.brand_knowledge_chunks ALTER COLUMN embedding DROP NOT NULL;
   UPDATE seo.brand_knowledge_chunks SET content_hash = repeat('0', 64);                         -- force re-embed
   ALTER TABLE seo.brand_knowledge_chunks ADD CHECK (embedding_dimensions = <N>);
   COMMIT;
   ```
   For more than 2,000 dimensions, HNSW needs `halfvec`: index
   `(embedding::halfvec(<N>)) halfvec_cosine_ops`.
4. Set `EMBEDDING_MODEL` and `EMBEDDING_DIMENSIONS` in workflows 01 and 02.
5. Run workflow 01 manually. Every chunk is re-embedded. Then restore
   `ALTER COLUMN embedding SET NOT NULL` and recreate the HNSW index.
6. Both workflows check that their configuration matches `seo.embedding_config`
   and stop with a `CONFIGURATION` error otherwise.
