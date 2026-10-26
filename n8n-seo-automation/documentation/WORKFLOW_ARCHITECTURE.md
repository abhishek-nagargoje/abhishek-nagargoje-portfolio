# Workflow architecture

```
Google Sheets (Keywords)                     Google Sheets (Brand_Knowledge)
        │                                                 │
        ▼                                                 ▼
02 SEO Article Automation                     01 Brand RAG Ingestion
  orchestrator lane                              approve → validate → normalise → chunk
  ├─ preflight (DB, Gemini models, plagiarism)   → SHA-256 → skip unchanged
  ├─ read / filter READY / validate / dedupe     → embed (gemini-embedding-001, 768, RETRIEVAL_DOCUMENT)
  └─ Execute Workflow (itself) once per keyword  → upsert seo.brand_knowledge_chunks (pgvector)
        │
        ▼  per-keyword sub-execution (isolated state, single item)
  claim (PostgreSQL lease) ─ RECOVER/SKIP/IN_PROGRESS routes
  fetch target page → HTML extract → analyse (fails closed: REVIEW / transient)
  RAG query → embed (RETRIEVAL_QUERY) → pgvector top-K + pinned categories → sufficiency gate
  Gemini 1: prompt creator (+ page/keyword fit gate, 1 bounded correction)
  Gemini 2: writer (1 bounded correction) ─────────────┐
                                                       ▼
  ┌──────────── ATTEMPT LOOP (max MAX_ARTICLE_ATTEMPTS) ────────────┐
  │ Prepare Attempt → record version + sha256                        │
  │ external-source reachability + deterministic claim checks        │
  │ Gemini 3: independent editorial evaluator (1 correction/attempt) │
  │ workflow decides PASS (all checks PASS, no unsupported claims)   │
  │   └─ PASS → plagiarism scan of THIS text (chunked, bounded poll) │
  │          └─ PASS (≤ threshold) → approval                        │
  │ any FAIL → Collect Attempt Failure → limit? → Gemini 4 reviser ──┘
  │ limit reached → REVIEW_REQUIRED (nothing written to the doc)
  ▼
  approval: format → doc lock (lease) → ledger begin (idempotency)
  → read doc end index → batchUpdate (writeControl.requiredRevisionId)
  → re-read doc, verify unique marker + article tail → ledger VERIFIED
  → finalize in PostgreSQL (APPROVED) → Sheets Keywords + Article_Log → sheet_synced
        │
03 Error Recovery (every 30 min + Error Trigger)
  release expired leases · reconcile PENDING/UNCERTAIN Docs writes by marker
  · retry Sheets bookkeeping · release claims of failed executions
```

## Why one workflow file calls itself

The article pipeline contains several bounded loops (corrections, revision
attempts, plagiarism polling, document-lock waiting). n8n loops are safe and
predictable when exactly **one item** flows through them. The orchestrator
therefore hands each keyword to a separate **sub-execution of the same
workflow**. It uses an Execute Workflow node with `workflowId = {{$workflow.id}}`
and the "When Called By Orchestrator" trigger. Benefits:

* per-keyword isolation: one keyword's failure cannot corrupt another's state;
* `$('Node').first()` always refers to the latest run of that node inside the
  keyword's own execution, which makes loop state explicit and testable;
* the delivered system stays three importable files, as requested.

## Source of truth and state

| State | Where | Notes |
|---|---|---|
| Keyword queue & status | `seo.keyword_records` (+ mirror in Sheets `Status`) | Sheets is the human control input (`READY`, reset). The DB decides |
| Claims / concurrency | `claimed_by_execution`, `lease_expires_at` | `claim_keyword()` uses `SELECT … FOR UPDATE`; every write calls `assert_claim()` (fencing) |
| Article versions | `seo.article_attempts` | Exact JSON + markdown + sha256 per attempt; editorial and plagiarism reports are attached to the attempt they evaluated |
| Plagiarism freshness | `plagiarism_content_sha256` | `record_plagiarism_result()` rejects a report for any other text (`PLAGIARISM_REPORT_STALE`) |
| Approval gate | `begin_doc_write()` | The DB refuses a Docs write unless the latest attempt's outcome is `PASSED` |
| Docs idempotency | `seo.doc_write_ledger` + unique marker line | PENDING → VERIFIED/UNCERTAIN/FAILED; VERIFIED is never downgraded |
| Doc concurrency | `seo.doc_locks` | Single writer per master doc; `writeControl.requiredRevisionId` as a second guard |
| History / audit | `seo.processing_events`, `brand_ingestion_runs/errors` | Safe messages only (secrets are scrubbed) |

## Status model (Keywords sheet)

`READY → PROCESSING → PROMPT_CREATED → ARTICLE_GENERATED → QUALITY_REVIEW →
(PLAGIARISM_CHECK | REVISION_REQUIRED → QUALITY_REVIEW …) → APPROVED`

Terminal or holding states:

* `REVIEW_REQUIRED`: page unusable, insufficient brand knowledge,
  keyword/page mismatch, attempt limit reached, too many technical failures,
  or an incomplete document write.
* `ERROR`: configuration or authentication problem; fix it, then set `READY`.
* `READY` with `Last_Error` set: a transient failure that will be retried on
  the next run, bounded by `MAX_TECHNICAL_FAILURES`.
* `SKIPPED_DUPLICATE`: another Keyword_ID already covers the same keyword and
  URL.
* `APPROVED`: a re-submitted, already-approved row stays `APPROVED` with a note.
  Set `Regenerate = TRUE` to authorise a new article.

## Failure classes

| Class | Examples | Handling |
|---|---|---|
| Content quality | evaluator FAIL, unsupported claim, structure errors | revision loop, then REVIEW_REQUIRED |
| Plagiarism | similarity > threshold, long unattributed match | revision loop with matched passages, then a new scan |
| API / network (transient) | 429, 5xx, timeouts, polling timeout, lock timeout | node retries with backoff; then sheet `READY` for the next run, up to `MAX_TECHNICAL_FAILURES` |
| Configuration | 401/403, unknown model, missing sheet columns, embedding dimension mismatch, async plagiarism not configured | `ERROR`, no automatic retry |
| Human review | page/keyword mismatch, JS-rendered page, insufficient brand knowledge | `REVIEW_REQUIRED` with explanation |

## Node map (workflow 02)

Orchestrator: Manual Test Trigger, Daily SEO Schedule → Workflow
Configuration → Preflight - Check Database → Preflight - Validate
Configuration → Preflight - Verify Gemini Models → Preflight - Verify
Plagiarism Account → Confirm Preflight → Read Keywords → Filter READY
Records → Validate URL and Keyword → Route Records → (Keyword ID Generated? →
Write Generated Keyword IDs → Restore Records After ID Write) → Build
Sub-Execution Payload → Process Keyword (Sub-Execution) → Summarize Run.
Invalid rows go to Mark Invalid Records; rows over the batch limit go to
Deferred To Next Run.

Per keyword: When Called By Orchestrator → Keyword Context → Claim Keyword
Record → Route Claim Result → Mark PROCESSING → Fetch Target Page → Extract
Target Page Content → Analyze Target Page → Validate Retrieved Page → Build
RAG Query → Generate RAG Query Embedding → Validate Query Embedding → Retrieve
Brand RAG Context → Validate Brand Context → Brand Context Sufficient? → Build
Gemini Prompt Creator Input → Gemini - Create Article Prompt → Validate Article
Prompt → Article Prompt Valid? → Record PROMPT_CREATED → Build Article Writer
Input → Gemini - Generate Article → Validate Article Structure → Prepare
Attempt → Record Article Attempt → Prepare Source Checks → Verify External
Source URLs → Aggregate Source Checks → Build Evaluator Input → Gemini -
Evaluate Editorial Quality → Validate Editorial Report → Check Editorial
Conditions → Record Editorial Result → Editorial Passed? → Prepare Plagiarism
Submission → Submit Plagiarism Scan → Normalize Plagiarism Response →
Plagiarism Report Status (→ Wait For Plagiarism Report → Build Poll Requests →
Retrieve Plagiarism Report → Normalize Poll Response) → Evaluate Plagiarism
Result → Record Plagiarism Result → Plagiarism Passed? → Format Approved
Article → Acquire Master Doc Lock → Check Article Idempotency → Get Master Doc
→ Build Docs Requests → Append Article to Master Google Doc → Read Master Doc
For Verification → Verify Google Docs Write → Ledger - Mark VERIFIED →
Finalize Approved Article → Update Keyword APPROVED → Log Approved Article →
Mark Sheet Synced → Keyword Outcome.

Revision: Collect Attempt Failure → Check Attempt Limit → Build Article
Revision Brief → Gemini - Revise Article → Revalidate Revised Article → Prepare
Attempt.

Errors: ten Tag Error - … nodes → Handle API Errors → Claim Lost? → Record
Technical Failure → Log Processing Failure → Log Failure To Article_Log.

Review: Prepare Review Outcome → Mark REVIEW_REQUIRED → Sheet - Mark
REVIEW_REQUIRED → Log Review Required Article.

## Maintaining the workflows

The JSON files are **generated**. Edit the sources, then run
`node tools/build_workflows.js` and `node tools/validate_workflows.js`:

* `tools/code/wf0X/*.js`: Code-node bodies (each file is one node);
* `tools/code/lib/*.js`: shared, unit-tested helpers, inlined at build time;
* `prompts/*.md`: system instructions, copied verbatim from between the
  markers;
* `tools/schemas.js`: Gemini `responseSchema` objects, also used for
  re-validation.

If you edit a workflow in the n8n UI instead, export it and keep that export as
your source of truth. The generator would overwrite UI-only changes.
