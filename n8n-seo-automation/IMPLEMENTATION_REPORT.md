# Implementation report

Date: 2026-10-26 · Target: n8n self-hosted (Hostinger VPS) · Built/tested with
n8n **2.44.6**, PostgreSQL **16.15**, pgvector **0.6.0**.

## 1. Existing files inspected

`SEO_Article_Automation.json`, `Brand_RAG_Ingestion.json`,
`pgvector_setup.sql` and `README_SETUP.txt` were searched for in the project
directory and across the whole container filesystem. **None of them existed.**
The repository contains a Next.js portfolio site and no n8n material, so the
system was built from scratch in `n8n-seo-automation/`. There was no earlier
implementation to audit.

## 2. Problems found (in this implementation, by testing)

Real execution on n8n 2.44.6 found defects that JSON/structural checks did not.
All are fixed and covered by regression checks:

1. Code-node task runners in n8n 2.x have no `URL`/`URLSearchParams` → own
   `parseUrl()`. The unit-test loader shadows these globals and the validator
   rejects them.
2. HTTP Request full-response text bodies arrive in `data`, not `body`.
3. `$('Node').first()` without an output index can read a node's empty
   **error** branch → all references are explicit (`.first(0)`), enforced by
   the validator.
4. A re-submitted approved row was overwritten as `SKIPPED_DUPLICATE` → now
   stays `APPROVED`, with a note.
5. Recovery left a crashed writer's document lock in place → finalisation now
   releases it.
6. CLI/test infrastructure issues (task-broker port 5679 clash, IPv6 listen
   address, webhook activation race) affected only the test harness.

## 3. Files created

`workflows/01–03`, `database/01–04`, `prompts/01–05`,
`configuration/{config.example.json, required_credentials.md, environment_variables.md}`,
`documentation/{SETUP_GUIDE, N8N_IMPORT_GUIDE, GOOGLE_SHEETS_SETUP, GOOGLE_DOCS_SETUP, GEMINI_API_SETUP, RAG_SETUP, PLAGIARISM_API_SETUP, TESTING_AND_TROUBLESHOOTING, WORKFLOW_ARCHITECTURE}.md`,
`templates/google_sheets/*`, `tools/*` (generator, sources, libraries,
validator, packager), `tests/*` (unit, database, e2e, results) and
`dist/n8n-seo-automation.zip`.

Outside this folder, `eslint.config.mjs` at the repository root now ignores
`n8n-seo-automation/**`, so the site's lint does not process Node tooling.

## 4. Status by component

| Component | Status | Evidence |
|---|---|---|
| 01 Brand RAG Ingestion | IMPLEMENTED · STRUCTURALLY_VALIDATED · IMPORTED · EXECUTED_SUCCESSFULLY (mocked Sheets/Gemini, real pgvector) | e2e I1–I3 |
| 02 SEO Article Automation | IMPLEMENTED · STRUCTURALLY_VALIDATED · IMPORTED · EXECUTED_SUCCESSFULLY (mocked Gemini/DupliChecker/Docs/Sheets/site, real PostgreSQL) | e2e T1–T15, V1, D1 |
| 03 Error Recovery | IMPLEMENTED · STRUCTURALLY_VALIDATED · IMPORTED · EXECUTED_SUCCESSFULLY (schedule path via webhook; Error Trigger fired by a real failed execution) | e2e T11b, T11c, T15 |
| Database schema (01–04) | EXECUTED_SUCCESSFULLY | DB test suite + 20-way concurrency |
| RAG (embedding, upsert, retrieval, sufficiency gate) | EXECUTED_SUCCESSFULLY with mocked embeddings | I1–I3, T5 |
| Gemini integration | IMPLEMENTED per documented REST contract; executed against a mock; **live API NOT_YET_TESTED** | T1, T-JSON, T-429, T-AUTH |
| DupliChecker integration | IMPLEMENTED from DupliChecker's documented contract (endpoints, `token`, `data`, `rephrased`, `details[].unique`, `exactMatchedPercent`, `rephrasedPercent`); fail-closed parser; async polling configurable; **live API NOT_YET_TESTED**; overall-percent field name and callback contract **unverified** | T7, T7b, T8, T8b |
| Google Docs integration | IMPLEMENTED (REST batchUpdate via Google Docs OAuth2 credential); executed against an index-validating mock; **live API NOT_YET_TESTED** | T1, T10, T11a, D1 |
| Google Sheets integration | IMPLEMENTED with native Sheets node v4.5; in e2e replaced by an equivalent HTTP mock (OAuth cannot be mocked); **live NOT_YET_TESTED** | all e2e |

## 5. Validation results

* JSON / export structure / node types and versions / parameters / options /
  credentials / expressions / Code syntax / node references / SQL parameter
  counts / connections / reachability / bounded loops / secrets: **0 errors**
  (`node tools/validate_workflows.js`). The validator was itself
  negative-tested with injected defects, and caught all of them.
* Import: **3/3** imported with `n8n import:workflow` (n8n 2.44.6).
* Unit **10/10**, database **all passed**, end-to-end **30/30**.

## 6. Credentials still required

Postgres (`n8n_seo_app`), Header Auth `x-goog-api-key` (Gemini), Query Auth
`token` (DupliChecker), Google Sheets OAuth2, Google Docs OAuth2. See
`configuration/required_credentials.md`.

## 7. Configuration values still required

`SPREADSHEET_ID` (01, 02, 03×2) and `MASTER_DOC_ID` (02, 03×2) are required.
Also confirm `BRAND_ID`/`BRAND_NAMES`, the Gemini model IDs (verify current
GA IDs), the error workflow setting on 01 and 02, real target URLs in
`Keywords`, and verified `Brand_Knowledge` rows. Optional:
`PLAGIARISM_POLL_URL_TEMPLATE` (if DupliChecker is asynchronous for your
account), `ALLOWED_TARGET_DOMAINS`, thresholds.

## 8. Limitations and blockers

* The official DupliChecker and Gemini documentation pages could not be
  opened from the build environment (network policy). Contracts were taken
  from search extracts of the official pages. The workflows verify them at run
  time (preflight) and fail closed on anything unrecognised.
* No live call to Gemini, DupliChecker or Google APIs was made. Docs heading
  and link rendering is validated for request structure and index ranges, not
  by viewing a real document.
* The E-E-A-T evaluation is an editorial framework, not a guarantee of Google
  rankings. The deterministic claim screen is heuristic, and may need tuning
  (`DETERMINISTIC_CLAIM_CHECKS`).
* Client-side-rendered target pages are flagged for review. No headless
  rendering is included.
* Typeversions are compatible with n8n ≥ 1.80 in principle; only 2.44.6 was
  tested.

## 9. Steps to import and run

See `documentation/SETUP_GUIDE.md`. In short:

1. Run SQL 01→04 and set the `n8n_seo_app` password.
2. Create the spreadsheet tabs and the master doc.
3. Create the 5 credentials in n8n.
4. Import 01/02/03, select credentials, set the IDs in the configuration
   nodes, and set 03 as the error workflow of 01 and 02.
5. Run 01 manually.
6. Run 02 manually with one READY row, and review the result.
7. Run with 5 rows.
8. Activate 03 → 01 → 02.
