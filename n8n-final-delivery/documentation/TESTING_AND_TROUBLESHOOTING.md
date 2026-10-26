# Testing and troubleshooting

## 1. What was tested before delivery — and what was not

**Be precise about this:** no live Google, Gemini or DupliChecker account was
available to the build environment (its network blocks those hosts, and the
connected Google account cannot see your spreadsheet). Everything that
involves those services was tested against **mocks** and is labelled MOCKED
below. Live integration testing on your Hostinger instance is still
outstanding (section 3).

| Test suite | Real components | Mocked | Result |
|---|---|---|---|
| `tests/validate_workflows.js` — structural validation | node types, type versions and parameter names checked against the real node registries of n8n **1.123.87** and **2.44.6** | — | all checks pass |
| CLI import (`n8n import:workflow`) of the three unmodified files | n8n 1.123.87 and 2.44.6 | credentials have dummy values | all 3 workflows import, stay inactive, every credential reference binds by name |
| `tests/ui_import_test.js` — editor import | n8n 2.44.6 editor in Chromium (Playwright), the editor's import file input, Save | credentials have dummy values | 11/11 — all nodes saved, all 57 credential references bound by name |
| `tests/sql_behaviour_tests.js` | PostgreSQL 16 + pgvector 0.6 (your server: 17 + 0.8.7) | — | 47/47 |
| `tests/code_unit_tests.js` | the helper code inlined in the Code nodes | — | 46/46 |
| `tests/run_e2e_mocked.js` — end-to-end | n8n engine (`n8n execute`, plus `n8n start` for the error workflow) 2.44.6 and 1.123.87; PostgreSQL + pgvector; every Code / Postgres / IF / Switch / Wait / HTTP node as shipped | **MOCKED** Gemini, DupliChecker, Google Docs, Google Sheets and the target website (`tests/mock_services.js`) | see `FINAL RESULTS` below |

FINAL RESULTS (end-to-end, MOCKED external services):
* n8n 2.44.6: **77/77 passed** (T1–T10: 71/71; T11 production Error Trigger path: 6/6)
* n8n 1.123.87: **77/77 passed** (T1–T10: 71/71; T11: 6/6)

### Requirement → test mapping
| # | Requirement | Covered by |
|---|---|---|
| 1 | All three workflows parse as JSON | validate_workflows |
| 2 | Required nodes and connections exist, no orphan/decorative nodes, all IF/Switch outputs connected, every loop bounded, no execution-order hazards | validate_workflows |
| 3 | Schema initialisation succeeds (idempotent, non-superuser) | sql_behaviour (applied twice as `seo_n8n`); e2e T1 |
| 4 | RAG ingestion reads approved rows | e2e T1 (MOCKED Sheets/Gemini, real DB) |
| 5 | Unapproved rows (`FALSE`, blank) skipped | e2e T1; sql (deactivation) |
| 6 | Repeated ingestion creates no duplicates, unchanged rows not re-embedded, changed rows updated | e2e T1; sql |
| 7 | Missing keyword list handled gracefully | e2e T2 |
| 8 | Inaccessible target URL / JS-only page not treated as analysed | e2e T3 (404 and JS shell) |
| 9 | Missing RAG context does not lead to invented company claims | design: brief/prompt rules, editorial "unsupported claims" gate, deterministic fact-ID check; e2e T7 (a critical unsupported claim blocks approval); sql (retrieval returns only active records of the same model) |
| 10 | Prompt creation and article writing are separate Gemini calls | e2e T4 (PROMPT before ARTICLE) |
| 11 | Invalid structured output fails safely (one corrective retry) | e2e T8 (prompt and article); unit (truncated / blocked output) |
| 12 | Editorial validation blocks critical factual failures | e2e T7; sql (approval gate) |
| 13 | DupliChecker requests follow the documented contract | e2e T4 (`/info` first, `/checkplag` with token in the body, `/query-footprint/{hash}/{key}` polling); unit (response interpretation) |
| 14 | Asynchronous polling terminates | e2e T9 (exactly `plagiarism_max_polls` polls, then TIMEOUT) |
| 15 | Failed article enters the revision loop | e2e T4 (25 % → reviser) |
| 16 | Revised article goes through both checks again | e2e T4 (2 editorial calls, 2 checkplag calls, distinct text hashes) |
| 17 | Maximum attempts enforced | e2e T7 (exactly 1 article + 2 revisions); sql (4th attempt rejected) |
| 18 | Google Doc created once and reused | e2e T4/T5 |
| 19 | Same Article_ID cannot be appended twice | e2e T5 (re-queued approved keyword), T6 (one marker); sql (ledger) |
| 20 | Failure after document insertion reconciled safely | e2e T6 (sweep), T6b (next run RECONCILE), T11 (Docs failure → resume at Docs stage) |
| 21 | No approval without a completed plagiarism report | e2e T9; sql (TIMEOUT never passes, gate rejects) |
| 22 | Two executions cannot claim the same record | e2e T10 (two simultaneous n8n processes); sql (five concurrent claims) |
| — | Error Trigger path in a production execution | e2e T11 (n8n server, webhook-started copy of workflow 02) |

Bugs found by these tests and fixed before delivery (for transparency):
* n8n passes array/object query parameters straight to pg-promise, which
  formats arrays as `text[]` — all object/array parameters are now
  `JSON.stringify`-ed explicitly.
* In n8n's v1 execution order sibling branches run one after another in
  canvas order; a side-branch progress update could overwrite the final
  status. Progress updates now run inline, and the structural validator
  rejects such fan-outs.
* `n8n execute` starts at the first trigger in the file; the recovery sweep
  is now first, and a manual run of the Error Trigger (sample data) no longer
  records a bogus error.
* A very short HTML body was reported as "empty" instead of "requires
  JavaScript rendering".
* n8n 2.x runs an error workflow only when it is **published** — now
  documented in IMPORT_AND_SETUP.md, step 2.
* n8n shortens some error messages to the text after their last colon (e.g.
  in a URL); the error workflow now stores the full message from the stack.
* Control characters in model output would be rejected by the Docs API; they
  are now replaced before insertion.

## 2. Running the tests yourself (optional)
Requirements: Node.js, a disposable PostgreSQL database with pgvector, and
the npm packages `pg`, `luxon` (and `playwright` for the UI test).
```
node tools/build_workflows.js            # regenerates workflows/*.json from tools/code and database/
node tests/validate_workflows.js <n8n>/node_modules/n8n-nodes-base/dist/types/nodes.json
PGHOST=... PGUSER=... PGPASSWORD=... PGDATABASE=<test db> node tests/sql_behaviour_tests.js
LUXON_MODULE=<path>/luxon node tests/code_unit_tests.js
WORK=<scratch dir> N8N_BIN=<n8n launcher> PGHOST=... PGPORT=... node tests/run_e2e_mocked.js
```
Never point the SQL or end-to-end tests at `seo_content`: they truncate tables.

## 3. Live acceptance test on your server (do this once)
1. Import, credentials and error workflow as in `IMPORT_AND_SETUP.md`.
2. Add 5–15 verified rows to `Brand_Knowledge` (Approved = TRUE) and run
   workflow 01. Expect `inserted` = number of approved rows; run it again and
   expect `inserted 0, unchanged N`.
3. Add one keyword row (Status READY) for a real hrremedyindia.com page and
   run workflow 02 manually. Expect, in order:
   * *Resolve Gemini Models* output shows the chosen `text_model`;
   * *Validate DupliChecker Account* passes (if it reports a rejected token,
     see section 4);
   * *Extract Target Page Content* shows a word count and headings;
   * *Retrieve Relevant Brand Context* returns your knowledge IDs;
   * the run ends with *Final Result* `APPROVED` (or `REVIEW_REQUIRED` with a
     concrete reason) and the master document appears in Google Drive.
4. Run workflow 02 again with no READY rows: it must stop with
   `NO_ELIGIBLE_KEYWORDS`.
5. Only then enable the schedule.

## 4. Troubleshooting

| Symptom (node / message) | Cause | Fix |
|---|---|---|
| Red credential warning on nodes after import | the credential name differs from the expected name | rename the credential (see `configuration/required_credentials.md`) or select it in the node, then save |
| *Check Gemini Models*: `CONFIG_ERROR: Gemini credential check failed … API key not valid` | wrong key / host in the Gemini credential | fix the key; Host must be `https://generativelanguage.googleapis.com` |
| *Resolve Gemini Models*: `no stable gemini-<version>-flash/pro model …` | your key only exposes preview models, or Google renamed models | set `gemini_text_model` in *Configuration* to one of the IDs listed in the error |
| *Validate DupliChecker Account*: `rejected the API token` | invalid token, or DupliChecker does not accept the JSON body | check the token; if correct, switch the credential JSON to `{"qs":{"token":"…"}}` |
| `plan has expired` / `only N words remaining` | DupliChecker account limits | renew / top up; nothing was claimed |
| *Verify Schema & Settings*: `knowledge base is empty` | workflow 01 not run, or no row approved | run workflow 01 with approved rows |
| *Verify Schema & Settings*: `spreadsheet_id … differs` | the Configuration nodes of 01 and 02 disagree, or you moved spreadsheets | correct the ID; for a deliberate move set `allow_spreadsheet_change: true` for one run |
| *Ensure Database Schema*: `pgvector extension "vector" is not installed` | extension missing in `seo_content` | as a superuser: `docker exec -it seo-postgres psql -U postgres -d seo_content -c "CREATE EXTENSION vector;"` |
| *Ensure Database Schema*: `permission denied for schema public` | `seo_n8n` cannot create tables | as a superuser: `GRANT CREATE ON SCHEMA public TO seo_n8n;` |
| Keyword stays READY, *Nothing Claimed* says `IN_PROGRESS` | another execution holds the lease (or crashed less than `lease_minutes` ago) | wait for the lease to expire (20 min) and run *Error Recovery → Manual Recovery Sweep*, or run 02 again later |
| Status REVIEW_REQUIRED, `[PAGE_ANALYSIS] … JavaScript rendering` | the page renders its text client-side | use a server-rendered URL, or add a prerendered page; the workflow does not execute JavaScript |
| Status REVIEW_REQUIRED, `[PLAGIARISM_CHECK] … TIMEOUT` | DupliChecker did not finish within 10 minutes | nothing to do: the recovery sweep (manual or every 30 min) collects the report within ~6.5 h and re-queues a passing article automatically |
| Status REVIEW_REQUIRED, `Article did not pass all checks after 3 of 3 attempts` | quality gate | read `EETA_Report` and `Last_Error`; improve brand facts or keyword/target page, set Status READY to start a new run |
| `CONFIG_ERROR: Google Docs credential lacks permission …` | Docs OAuth scope or document access | reconnect the Google Docs credential (scope `documents`); the error workflow re-queues the job, which resumes at the Docs stage |
| `LEASE_LOST at …` | another execution took over an expired lease | nothing to do; the other execution continues the job |
| Article_Log or Keywords not updated although the article is in the doc | a Google Sheets write failed | run *Error Recovery → Manual Recovery Sweep* (or the next 02 run reconciles automatically) — never regenerated, never re-appended |

Useful queries (read-only), e.g. `docker exec -it seo-postgres psql -U seo_n8n -d seo_content`:
```sql
SELECT article_id, keyword_id, status, attempts, current_stage, lease_owner, lease_expires_at, last_error
  FROM seo_article_jobs ORDER BY updated_at DESC LIMIT 20;
SELECT article_id, attempt_no, editorial_status, plagiarism_status, plagiarism_percent, decision
  FROM seo_article_attempts ORDER BY updated_at DESC LIMIT 20;
SELECT * FROM seo_document_ledger ORDER BY updated_at DESC LIMIT 20;
SELECT * FROM seo_execution_errors ORDER BY created_at DESC LIMIT 20;
SELECT setting_value FROM seo_settings WHERE setting_key = 'master_doc';
SELECT knowledge_id, category, is_active, updated_at FROM seo_brand_knowledge ORDER BY knowledge_id;
```
