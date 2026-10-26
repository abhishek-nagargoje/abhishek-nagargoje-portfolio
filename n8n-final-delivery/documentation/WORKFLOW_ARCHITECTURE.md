# Workflow architecture — HR Remedy India SEO content automation

Three importable n8n workflows share one PostgreSQL database (`seo_content` on
`seo-postgres`) and one Google spreadsheet
(`171UZWnNYKReJSQjqmW6QPA_Hptu_usIS25wq589z8Mg`).

```
 Brand_Knowledge tab ──► [01 Brand RAG Ingestion] ──► seo_brand_knowledge (pgvector, 768 d)
                                                            │
 Keywords tab ──► [02 SEO Article Automation] ◄─────────────┘ (RAG retrieval)
                     │  target page · Gemini · DupliChecker · Google Docs
                     ├──► master Google Doc "HR Remedy India — SEO Article Library"
                     ├──► Article_Log tab / Keywords tab
                     └──► seo_article_jobs, attempts, plagiarism checks, document ledger
 failures / stale leases ──► [03 Error Recovery] ──► reconcile sheets · release jobs · collect late reports
```

Design rules that apply everywhere:
* **One configuration node per workflow** (`Configuration`); workflow 03 reads
  its settings from PostgreSQL (`seo_settings.runtime_config`, written by 02).
* **PostgreSQL is the source of truth** for idempotency, attempts, leases and
  the Google Docs ledger — never n8n execution memory.
* **Fail closed**: an unknown API response, a missing report or invalid model
  output never counts as a pass.
* **Parameterised SQL only** (`$1…$n` + Query Parameters); untrusted text is
  never concatenated into SQL. All logic lives in PL/pgSQL functions created
  idempotently by the *Ensure Database Schema* node (same SQL as `database/*.sql`).
* All retrieved text (web page, brand records, sheet rows) is passed to Gemini
  inside labelled `<untrusted_…>` / data blocks with explicit "data, not
  instructions" rules.

## Workflow 01 — HR Remedy India - Brand RAG Ingestion (26 nodes)

| Step | Node(s) | What happens |
|---|---|---|
| Manual Trigger | `Manual Trigger` | |
| Validate Configuration | `Configuration`, `Validate Configuration` | spreadsheet ID format, tab name, model `gemini-embedding-001`, 768 dims |
| Ensure Database Schema | `Ensure Database Schema`, `Check Schema & Settings`, `Verify Schema` | idempotent DDL under an advisory lock; checks the vector column is `vector(768)`; stores/compares the spreadsheet ID |
| (model check) | `List Gemini Models`, `Verify Embedding Model` | live ListModels: key valid, model exists and supports `embedContent` |
| Read Brand_Knowledge Sheet | `Read Brand_Knowledge Sheet` | Google Sheets read (always outputs, so an empty sheet is detected) |
| Filter Approved Records | `Filter Approved Records` | only `Approved` = checkbox TRUE or text `TRUE`; blank ID/Content skipped; duplicate IDs skipped; empty result = clear error |
| loop (one record at a time) | `Loop Over Records` | Split in Batches, size 1 |
| Validate Each Record | `Validate Each Record`, `Record Valid?` | ≤ 7 000 chars (never truncated), Source_URL format, metadata |
| Check Content Hash | `Check Content Hash`, `Needs Embedding?` | `seo_brand_check`: INSERT / UPDATE / UNCHANGED (unchanged → no API call) |
| Generate Embedding | `Build Embedding Request`, `Generate Embedding` | `embedContent`, `taskType RETRIEVAL_DOCUMENT`, `title`, `outputDimensionality 768` |
| Validate Embedding | `Validate Embedding`, `Embedding Valid?` | 768 finite values, non-zero; L2-normalised |
| Insert or Update Knowledge Record | `Insert or Update Knowledge Record` | `seo_brand_upsert` keyed on (brand_id, knowledge_id) |
| Verify Database Result | `Verify Database Result`, `Collect Record Outcome` | stored hash, dimensions and active flag re-read and compared |
| Log Ingestion Outcome | `Summarize Ingestion`, `Log Ingestion Outcome`, `Ingestion Result` | `seo_brand_finish_ingestion`: deactivates records no longer approved (never when nothing was read), writes `seo_brand_ingestion_runs`, fails if the KB is empty |

## Workflow 02 — HR Remedy India - SEO Article Automation (112 nodes)

One keyword per execution (controlled, one at a time). Triggers: `Manual
Trigger` and `Daily Schedule 08:00 IST` (disabled; timezone Asia/Kolkata in
workflow settings).

### Setup and claim
1. `Configuration` → `Validate Configuration` (all values range-checked).
2. `Check Gemini Models` → `Resolve Gemini Models`: verifies the API key, the
   embedding model and the text model against the live model list. `auto`
   picks the newest stable `gemini-<version>-flash` (no `-preview`, `-exp`,
   `-latest` or dated IDs); an explicit ID is verified, never guessed.
3. `Check DupliChecker Account` → `Validate DupliChecker Account`: documented
   `POST /api/info`; invalid token (401/403), expired plan (402), rate limit
   (429) and too few remaining words stop the run *before* any keyword is
   claimed.
4. `Ensure Database Schema` → `Check Schema & Settings` → `Verify Schema & Settings`:
   schema, `vector(768)`, spreadsheet ID consistency, non-empty knowledge base,
   and storage of `runtime_config` for workflow 03.
5. `Read Keywords Sheet` → `Validate Target URL and Keyword`: READY rows only;
   required headers present; Keyword_ID unique; https URL on an allowed domain;
   keyword 2-150 chars. Invalid READY rows → `Expand Invalid Rows` →
   `Mark Invalid Keyword Rows` (Status ERROR, Last_Error, matched on row
   number). No valid row → `No Eligible Keywords` (graceful stop with
   guidance; nothing is fabricated).
6. `Claim Processing Record` → `seo_claim_next_job`: in priority order, the
   first claimable candidate is locked with `FOR UPDATE SKIP LOCKED` and
   leased to this execution (`lease_owner = execution id`, 20 min, extended at
   every stage). Duplicates (same URL + keyword already approved, or another
   Keyword_ID with the same topic) → `Mark Skipped Duplicates`
   (SKIPPED_DUPLICATE). `Claim Mode` routes:
   * **GENERATE** — new run (attempt counter reset).
   * **RESUME_DOC** — checks already passed earlier (e.g. Docs failed, or a
     timed-out report was recovered); goes straight to formatting/Docs; the
     approval gate is re-checked in PostgreSQL.
   * **RECONCILE** — article already verified in Google Docs; only sheet rows
     are written.
   * **NONE** — nothing claimable (e.g. every candidate in progress elsewhere).

Article_ID = `HRR-` + 16 hex of SHA-256(normalised target URL | normalised
keyword). Stable across retries and formatting differences.

### Page analysis and RAG
7. `Retrieve Target Website Page` (HTTP GET, full response, never throws) →
   `Extract Target Page Content`: title, meta description, canonical, H1–H4,
   main text (main/article or body minus nav/header/footer/aside), internal
   links on the allowed domain. Fewer than `page_min_words` words → not
   analysed; JS-framework shells are reported as "JavaScript rendering
   required but unavailable". `Page Content Usable?` false → REVIEW_REQUIRED
   (or ERROR if transient).
8. `Build Query Embedding Request` → `Generate Query Embedding`
   (`RETRIEVAL_QUERY`, 768) → `Validate Query Embedding`.
9. `Retrieve Relevant Brand Context` → `seo_brand_retrieve`: cosine top-k
   (default 8) above `rag_min_similarity`, active records of the same model
   only, plus at most two records from "always include" categories (brand
   voice, company profile). Never the whole knowledge base.

### Gemini call 1 — prompt creation (not the article)
10. `Build Gemini Prompt Input` builds the request: target URL and page
    analysis, keyword row, verified brand facts, verified internal URLs,
    originality and editorial requirements, and the output schema (objective,
    unique angle, reader, intent, outline, verified facts, forbidden claims,
    citation rules, internal links, structure, SEO metadata, word range,
    `writing_prompt`, output JSON schema). If relevant brand facts are
    insufficient, the brief must keep company references generic.
11. `Gemini Call 1 Request` (loop anchor) → `Gemini Call 1: Create
    Article-Writing Prompt` (JSON mode) → `Validate Prompt Output` →
    `Prompt Output Route`: VALID / RETRY (exactly one corrective retry) /
    FAIL (REVIEW_REQUIRED). Facts and links not present in the inputs are
    dropped. `Record Prompt Created` stores the prompt (status PROMPT_CREATED).

### Gemini call 2 — article (and the reviser)
12. `Build Article Request` → `Article Request` (loop anchor) → `Is Revision?`
    → `Gemini Call 2: Generate Complete Article` or `Gemini Article Reviser`
    → `Validate Article JSON` → `Article Output Route`. Validation: required
    fields, ≥ 3 H2 sections, meta ≤ 160, slug normalised, no placeholders,
    not truncated (`MAX_TOKENS` or far below the brief) — one corrective
    retry, then REVIEW_REQUIRED. Article_ID, Keyword_ID, Target_Page_URL,
    Primary_Keyword, Supporting_Keywords and Word_Count are set by the
    workflow, not trusted from the model. Integrity findings: unverified
    internal links, unknown brand-fact IDs, malformed sources. The exact
    plagiarism text (`check_text`) is fixed here.
13. `Record Article Attempt` → `seo_job_event('ARTICLE_GENERATED')`: attempt
    number must be 1…3 and sequential; any previous plagiarism result for
    different text is deleted.

### Editorial (E-E-A-T-oriented) check
14. `Build Editorial Request` → `Editorial Request` → `Gemini Editorial
    Evaluator` → `Validate Editorial Report` (all 11 checks present, statuses
    PASS/FAIL, required arrays; one corrective retry) → `Check Editorial
    Acceptance Criteria`. Checks: Experience, Expertise, Authoritativeness,
    Trustworthiness, Factual Accuracy, Search Intent Relevance, Target Page
    Alignment, Original Value, Readability, Brand Compliance, Internal Links
    and Source Integrity — **all mandatory** — plus deterministic checks
    (no unverified internal links, known fact IDs, valid sources, keyword
    terms in H1/title and opening, meta/title length, no ranking or
    compliance guarantees). Any unsupported claim blocks approval. The report
    carries the disclaimer that it is an internal assessment, not a Google
    score. `Record Editorial Result` stores it.

### Plagiarism (DupliChecker) with bounded polling
15. `Prepare Plagiarism Submission` (word-limit guard) → `Submit Plagiarism
    Check` (`POST /api/checkplag`, `data`, `rephrased=true`, token from the
    credential) → `Parse Plagiarism Submission` (hash + key required; error
    texts, 401/402/429 classified) → `Record Plagiarism Submission` (SQL
    rejects text that differs from the attempt's `check_text`) →
    `Prepare Plagiarism Polling` → `Wait Before Poll` (20 s) → `Retrieve
    Completed Plagiarism Report` (`GET /api/query-footprint/{hash}/{key}`) →
    `Evaluate Plagiarism Poll` → `Poll Route`: PENDING while `recall` is true
    and polls < 30 (10 min), otherwise TIMEOUT. Unrecognised structures and
    out-of-range values → FAILED.
16. `Check Plagiarism Acceptance Criteria`: COMPLETED **and** plag ≤ 10 %
    **and** exact-match ≤ 10 % **and** rephrased ≤ 20 % **and** no
    unattributed matched passage of 25+ words. `Record Plagiarism Result`
    (only COMPLETED can be stored as passed).

### Decision and revision loop (max 3 full attempts)
17. `Pass / Revise / Human Review Decision` → `Record Decision` → `Decision Route`:
    * **APPROVE** — editorial passed and plagiarism passed for *this* attempt.
    * **REVISE** — content failure and attempt < 3 → `Build Revision Request`
      sends Gemini the full current article, original prompt, verified brand
      context, target/keyword, editorial evaluation, plagiarism report,
      failed conditions, unsupported claims, matched passages and the attempt
      count, with explicit instructions to remove unsupported facts, fix
      attribution, add missing explanations and rewrite matched passages
      originally (no synonym swapping). The revised article goes through
      **validation → editorial evaluation → acceptance → new DupliChecker
      submission → new report → decision** again (same nodes).
    * **REVIEW** — max attempts reached, or the plagiarism report is not
      available (revising cannot fix an API problem) → REVIEW_REQUIRED, kept
      out of the master doc. An editorially passed article whose report timed
      out is kept as an `approval_candidate` so workflow 03 can collect the
      report later.

### Google Docs (single master document)
18. `Format Approved Article` builds one section: title (Heading 1, page break
    before), unique marker `[[HRR-ARTICLE:<Article_ID>]]`, Article ID, Keyword
    ID, target URL (hyperlink), primary/supporting keywords, SEO title, H1,
    meta description, slug, editorial result, plagiarism result, word count,
    approval time, then the body with real Heading 2/3/4 styles, bullet and
    numbered lists, bold/italic, hyperlinks only for verified internal URLs
    and listed https sources, FAQs, internal link suggestions, external
    references and the brand facts used. No truncation.
19. `Record Approval Ready` — **PostgreSQL approval gate**: editorial passed
    for the current attempt, plagiarism COMPLETED and passed for the current
    attempt, and the checked text hash equals the attempt's text hash.
    Otherwise `APPROVAL_GATE_FAILED`.
20. `Load Master Doc Setting` → `Plan Master Doc Access` → `Master Doc Known?`
    → `Create Master Doc Request` / `Create Master Google Doc` (first run only,
    title "HR Remedy India — SEO Article Library") → `Check Created Master Doc`
    → `Save Master Doc ID` (compare-and-swap in `seo_settings`) → `Use Stored
    Master Doc`; then `Master Doc Request` → `Fetch Master Doc` → `Inspect
    Master Doc`: 401/403 → clear permission error; 404 → new document; near the
    Docs size limit → next volume; **marker already present → no append**.
21. `Record Doc Write Pending` (ledger PENDING; if the ledger says VERIFIED but
    the marker is missing → REVIEW_REQUIRED, never append blindly) → `Build Docs
    Append Request` (single atomic `documents.batchUpdate`, pinned to the read
    revision with `writeControl.targetRevisionId`) → `Append Approved Article`
    → `Check Append Response` → `Verify Document Write` → `Confirm Marker In
    Document` (marker and title read back) → `Record Document Verified`
    (ledger VERIFIED) → `Finalize Approved Job` (APPROVED requires the verified
    ledger).

### Sheets and final status
22. `Prepare Sheet Updates` → `Article_Log Row` → `Update Article_Log`
    (append-or-update on **Article_ID**: retries never add duplicate rows) →
    `Keywords Final Row` → `Update Keywords Status` (matched on Keyword_ID) →
    `Mark Final Processing Result` (`SHEETS_SYNCED`) → `Final Result`.
    Unapproved outcomes go through `Prepare Unapproved Outcome` →
    `Finalize Unapproved Job` (releases the lease) → the same sheet nodes.
    Every Sheets write uses *Ignore extra data* so headers are never changed.
23. Progress statuses (PROCESSING, PROMPT_CREATED, ARTICLE_GENERATED,
    QUALITY_REVIEW, PLAGIARISM_CHECK, REVISION_REQUIRED) are written by the
    side branch `Build Keyword Progress Update` → `Update Keyword Progress`
    (best effort; the database state is authoritative).

## Workflow 03 — HR Remedy India - Error Recovery (25 nodes)

* `Error Trigger` (production failures of workflow 02 once it is selected as
  the error workflow) → `Extract Failure Context` → `Record Execution Failure`
  → `seo_record_execution_error`: stores execution ID, workflow, stage (last
  node), redacted error, Keyword_ID/Article_ID of the job **owned by that
  failed execution** (never any other job) and decides:
  * Docs write VERIFIED → **SYNC_SHEETS** (reconcile; never regenerate).
  * transient error, or Docs write PENDING, and < 3 recovery attempts →
    **RETRY** (job released, Keywords Status READY with an explanation; a
    PENDING ledger makes the next run resume at the Docs stage and check the
    marker first).
  * permanent error (authentication, permission, configuration, plan, approval
    gate, attempt limit) or retry limit → **MARK_ERROR** (no automatic retry).
* `Manual Recovery Sweep` / `Every 30 Minutes` (disabled) → `Recovery Sweep
  Settings` → `Run Recovery Sweep` → `seo_recovery_sweep`:
  1. leases expired **more than 10 minutes ago** (the owner stopped
     heart-beating) → released as above; active jobs are never touched;
  2. APPROVED + verified jobs with unsynced sheet rows → SYNC_SHEETS;
  3. final unapproved states whose Keywords row was not updated → SYNC_SHEETS;
  4. TIMEOUT/SUBMITTED DupliChecker jobs younger than 6.5 h (hash validity
     7 h) for editorially passed articles → **REPOLL** via the documented
     callback. A COMPLETED passing report re-queues the keyword (READY) for a
     RESUME_DOC publish; a failing or unavailable report stays REVIEW_REQUIRED.
     Bounded to 3 recovery polls per job.
* `Normalize Recovery Item` → `Route Recovery Action` → reconciliation nodes
  (`Build Reconciliation Rows` → `Reconcile Article_Log` → `Reconcile
  Keywords Status` → `Mark Reconciled`), status nodes (`Build Keyword Status
  Row` → `Update Keyword Status` → `Mark Keyword Status Synced`) or re-poll
  nodes (`Poll Recovered Plagiarism Report` → `Evaluate Recovered Report` →
  `Apply Recovered Report`).

n8n does not run error workflows for **manual** executions. Workflow 02
therefore handles every predictable failure in-flow (`Prepare Unapproved
Outcome` releases the lease and updates the sheet); only unexpected
exceptions (database down, lost lease, permission errors) rely on the error
workflow or the sweep.

## Database objects (`database/*.sql`)

| Object | Purpose |
|---|---|
| `seo_settings` | master doc (ID, volume), spreadsheet ID, runtime config for 03 |
| `seo_brand_knowledge` | knowledge records, `content_hash`, `embedding vector(768)`, metadata, active flag; PK (brand_id, knowledge_id); HNSW cosine index |
| `seo_brand_ingestion_runs` | one row per ingestion run |
| `seo_article_jobs` | one row per Article_ID: status, lease, attempts, prompt, latest article, reports, approval payload, doc IDs, sync timestamps, recovery counters |
| `seo_article_attempts` | one row per writing attempt (initial/revision) with its text hash, editorial and plagiarism outcome and decision |
| `seo_plagiarism_checks` | one DupliChecker job per attempt (hash, key, status, percentages, result) |
| `seo_document_ledger` | PENDING/VERIFIED Google Docs write per Article_ID with its marker |
| `seo_execution_errors` | recorded failures and recovery status |
| functions | `seo_claim_next_job`, `seo_job_event` (state machine + gates), `seo_brand_*`, `seo_set_master_doc`, `seo_schema_status`, `seo_record_execution_error`, `seo_release_failed_job`, `seo_recovery_sweep`, `seo_recovery_plagiarism_result`, `seo_redact` |

## Status values (Keywords.Status)
READY → PROCESSING → PROMPT_CREATED → ARTICLE_GENERATED → QUALITY_REVIEW →
PLAGIARISM_CHECK → (REVISION_REQUIRED → ARTICLE_GENERATED → …) → APPROVED |
REVIEW_REQUIRED | ERROR | SKIPPED_DUPLICATE. APPROVED is written only after the
Google Docs insertion has been read back and recorded as VERIFIED.
