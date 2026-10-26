# Testing and troubleshooting

## Evidence levels used in this project

| Level | Meaning |
|---|---|
| IMPLEMENTED | Code/workflow exists |
| STRUCTURALLY_VALIDATED | Passed `tools/validate_workflows.js`, which checks against n8n 2.44.6 node definitions |
| IMPORTED | Imported into a real n8n 2.44.6 instance with `n8n import:workflow` |
| EXECUTED_SUCCESSFULLY | Executed on a real n8n 2.44.6 server, with real PostgreSQL 16 + pgvector 0.6.0, and **mocked external HTTP services** (Gemini, DupliChecker, Google Docs, Google Sheets, target website) |
| NOT_YET_TESTED | Requires your real accounts (live Gemini, DupliChecker, Google) |

**No test in this repository called the live Gemini API, DupliChecker,
Google Sheets or Google Docs.** Those services were emulated by
`tests/e2e/mock_services.js` according to their documented contracts. The live
acceptance tests below must be run on your server.

## Test suites

| Suite | Command | What it proves |
|---|---|---|
| Unit | `node --test tests/unit/*.test.js` | Shared Code-node libraries (URL parsing without `URL`, validation, deterministic claim checks, plagiarism normalisation, Docs request building), run with sandbox-missing globals shadowed |
| Database | `PGDB=<throwaway_db> bash tests/run_database_tests.sh` | Schema applies twice (idempotent); RAG upsert/retrieval; claim/fencing; stale-report guard; approval guard; ledger and recovery; 20-way concurrency |
| Structural | `node tools/validate_workflows.js` | JSON/export shape; node types and typeVersions exist; parameter names and option values valid; credentials; expression and Code syntax; `$('Node')` references; SQL parameter counts; every branch connected; reachability; all loops bounded; no secrets; no sandbox-unavailable globals |
| End-to-end | `N8N_BIN=<n8n> node tests/e2e/run_e2e.js` | Real n8n server executes test copies of all three workflows. Copies differ only in config values, Sheets nodes swapped for HTTP calls to an in-memory sheet, and an added webhook trigger. Assertions are made on PostgreSQL, the mock sheet, the mock document and the call log |

End-to-end prerequisites: n8n 2.x CLI on PATH (Node ≥ 24), a local PostgreSQL
superuser for `psql`, and `/etc/hosts` entries
`127.0.0.1 kargar-test.example refs.example`.

## Actual results (2026-10-26, n8n 2.44.6, PostgreSQL 16.15, pgvector 0.6.0)

* Unit: **10/10 passed**
* Database: **all assertions passed**, concurrency **20 parallel claims → 1 CLAIMED, 19 IN_PROGRESS**
* Structural validation: **0 errors** (01: 21 nodes; 02: 133 nodes, 6 cycles,
  all bounded; 03: 32 nodes)
* Import: **all 3 workflows imported** into n8n 2.44.6
* End-to-end: **30/30 passed** (`tests/results/e2e_results.json`; resulting
  mock master document text in `tests/results/e2e_master_doc_text.txt`)

### Required tests → results

| # | Required test | E2E id | Result |
|---|---|---|---|
| 1 | Single input | T1 | PASSED: APPROVED, appended once; Sheets, Article_Log and DB consistent |
| 2 | Five inputs | T2 | PASSED: 5 independent articles, each associated with its own Keyword_ID/URL |
| 3 | Duplicate input | T3 | PASSED: no generation, no Docs write; the completed row stays APPROVED with a note; the duplicate under a new ID becomes SKIPPED_DUPLICATE |
| 4 | Page retrieval failure | T4 (+T4b mismatch) | PASSED: 404 → `PAGE_HTTP_404`, JS shell → `PAGE_REQUIRES_JS_RENDERING`, keyword/page mismatch → review; no article generated |
| 5 | Missing RAG information | T5 | PASSED: `INSUFFICIENT_BRAND_CONTEXT`, Gemini never asked to write |
| 6 | Editorial failure | T6 | PASSED: evaluator FAIL → reviser receives the exact failed conditions → re-evaluated → approved |
| 7 | Plagiarism failure | T7 (+T7b async) | PASSED: 50% similarity → revision → **new** scan of new text (different sha256) → approved; async report polled and approved |
| 8 | Plagiarism API failure | T8 (+T8b timeout) | PASSED: 401 → not approved, CONFIGURATION error; poll timeout → not approved, retried later |
| 9 | Repeated failure | T9 | PASSED: exactly 3 evaluations + 2 revisions, then REVIEW_REQUIRED; all 3 reports kept |
| 10 | Docs write failure | T10 | PASSED: 403 → not APPROVED, ledger FAILED, nothing appended; retry later appends once |
| 11 | Partial success | T11a/T11b/T11c (+T15) | PASSED: uncertain write reconciled by marker; Sheets failure re-synced by recovery; crash after write reconciled; never a second append |
| 12 | Concurrency | T12 (+T12b/T12c, DB test) | PASSED: two simultaneous runs → one claim, one article, one append; doc lock wait and timeout bounded |
| 13 | Unsupported brand claim | T13 (+T6) | PASSED: invented "500+ clients" caught by deterministic checks even though the evaluator said PASS; invented award/ISO claim caught by the evaluator |
| 14 | Five-article recovery | T14 | PASSED: 2 approved once; review/error items kept out of the doc; re-queue regenerates only the failed ones |
| — | Ingestion | I1–I3 | PASSED: embed approved rows only; re-run makes 0 embedding calls; changed row re-embedded; unapproved row soft-deactivated |
| — | Robustness | T-JSON, T-429, T-AUTH, V1, D1 | PASSED: one bounded correction for malformed JSON (×3 roles); 429 retried; Gemini auth failure stops in preflight; invalid input rows rejected with reasons; master doc has one marker per approved article |

### Defects found and fixed by executing in real n8n

Structural validation alone could not have found these:

1. `URL`/`URLSearchParams` are **not available** in n8n 2.x Code-node task
   runners → replaced by `parseUrl()` in `lib/common.js`. Unit tests now shadow
   these globals, and the validator rejects them.
2. HTTP Request v4.2 with *Full Response* and *Text* format returns the body
   in **`data`**, not `body` → fixed in HTML extraction, plagiarism and
   preflight parsing.
3. `$('Node').first()` without an output index reads the output found via the
   first connection path. For nodes with an error output this can be the
   **empty error branch** → every reference now uses `.first(0)` / `.all(0)`,
   and the validator enforces it.
4. Behaviour fix: an already-approved row re-submitted as READY now stays
   `APPROVED`, with a note, instead of being overwritten as `SKIPPED_DUPLICATE`.

## Acceptance tests on your server (NOT_YET_TESTED live)

Run these in order with real credentials and **test data**: a test master
document, a copy of the spreadsheet, and 1–5 real pages of your site.

1. **Ingestion:** 5–10 verified `Brand_Knowledge` rows → run 01 →
   `status: SUCCESS`; re-run → `chunks_unchanged` = all, 0 embedding calls.
2. **Single keyword (Test 1):** one READY row → run 02 manually → inspect the
   Google Doc section (headings, bullets, links, page break, marker),
   `Article_Log`, and `SELECT * FROM seo.article_attempts`.
3. **Duplicate (Test 3):** set the same row back to READY → run → no new
   section.
4. **Page failure (Test 4):** a URL that returns 404 → REVIEW_REQUIRED.
5. **Plagiarism provider:** confirm the preflight passes; check the stored
   report (`plagiarism_report` in `seo.article_attempts`) matches what
   DupliChecker shows. If DupliChecker responds asynchronously, configure
   `PLAGIARISM_POLL_URL_TEMPLATE` first.
6. **Five keywords (Test 2)**, then review every article manually before
   activating the schedule.
7. Optional fault tests: revoke the automation account's edit access to the
   master doc for one run (Test 10). Expected: not approved, then approved on
   the next run after restoring access.

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| Run stops at **Workflow Configuration** with `CONFIGURATION: SPREADSHEET_ID is not configured` | Placeholder IDs | Edit the configuration node |
| **Preflight - Check Database** fails: relation/function does not exist | SQL scripts not applied, or wrong DB in credential | Run `database/01…04`; check the Postgres credential's database |
| **Preflight - Validate Configuration**: embedding mismatch | Workflow model/dims ≠ `seo.embedding_config` | Fix the config or follow "Changing the embedding model" (RAG_SETUP.md) |
| Preflight: brand knowledge base is empty | 01 not run, or no approved rows | Add approved rows; run 01 |
| **Preflight - Verify Gemini Models** 404 | Model ID retired or mistyped | Update the model IDs (GEMINI_API_SETUP.md) |
| Preflight 400/403 from Gemini | Key invalid, or API not enabled | Recreate the Header Auth credential |
| **Confirm Preflight**: plagiarism provider rejected the account check | Token, plan or auth placement | PLAGIARISM_API_SETUP.md → Authentication fallbacks |
| Keyword `REVIEW_REQUIRED` `PAGE_REQUIRES_JS_RENDERING` | Page content rendered client-side | Enable SSR/prerendering for that page; access controls are never bypassed |
| `INSUFFICIENT_BRAND_CONTEXT` | No approved knowledge relevant to the keyword | Add verified rows for the topic, run 01, set the row to READY |
| `KEYWORD_PAGE_MISMATCH` | Keyword doesn't fit the target page | Choose a better target page or keyword |
| Many `REVIEW_REQUIRED` after 3 attempts | Strict evaluator, thin knowledge, or deterministic claim checks | Read `failed_conditions` in `seo.v_review_queue`. Improve knowledge or prompts; if justified, set `DETERMINISTIC_CLAIM_CHECKS` to `advisory` |
| `PLAGIARISM_ASYNC_NOT_CONFIGURED` | Provider returned a job reference | Set `PLAGIARISM_POLL_URL_TEMPLATE` from the provider docs |
| `REPORT_UNPARSEABLE` | Provider response format differs | Inspect `seo.processing_events`. Set `PLAGIARISM_PERCENT_FIELD`, or adapt `lib/plagiarism.js` |
| Status stays `PLAGIARISM_CHECK` or similar for hours | n8n restarted mid-run | 03 releases expired leases (180 min) and re-queues; or run 03 manually |
| Article in doc but sheet not APPROVED | Sheets update failed after the write | 03 syncs it automatically (`sheet_synced = false` list) |
| Duplicate section suspected | Should not happen: marker + ledger + revision check | `SELECT * FROM seo.doc_write_ledger WHERE article_id = '…'`; search the doc for `SEO-ARTICLE-MARKER: <id>` |
| `CLAIM_LOST` in events | A stale execution lost its lease to a newer one | Expected safety behaviour; nothing to fix unless frequent (raise `CLAIM_LEASE_MINUTES`) |
| Code node error `X is not defined` after editing | Library not included in that node | Add it to the node's `// @include` line, rebuild, validate |

Useful SQL:

```sql
SELECT * FROM seo.v_review_queue;
SELECT keyword_id, status, last_error_class, last_error, technical_failures FROM seo.keyword_records ORDER BY updated_at DESC LIMIT 20;
SELECT article_id, attempt_no, editorial_status, plagiarism_status, plagiarism_percent, outcome FROM seo.article_attempts ORDER BY created_at DESC LIMIT 20;
SELECT * FROM seo.processing_events ORDER BY event_id DESC LIMIT 50;
SELECT * FROM seo.doc_write_ledger WHERE state <> 'VERIFIED';
```
