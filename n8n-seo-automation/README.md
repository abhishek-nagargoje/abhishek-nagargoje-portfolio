# n8n SEO Content Automation (KARGAR Facility Management)

Importable n8n workflows that turn **(target page URL + primary keyword)**
rows in Google Sheets into **original, brand-accurate supporting articles**.
Only articles that pass every mandatory automated check are appended to one
master Google Doc. Nothing is published to the website automatically.

```
Google Sheets → target-page analysis → brand RAG (PostgreSQL + pgvector)
→ Gemini prompt creation → Gemini article writing → structured-output validation
→ independent E-E-A-T-oriented evaluation + deterministic claim/source checks
→ DupliChecker plagiarism scan → automatic revision with full re-validation (max 3 attempts)
→ approved article appended once to Google Docs → Sheets + PostgreSQL history → recovery
```

## Contents

| Path | What |
|---|---|
| `workflows/01_Brand_RAG_Ingestion.json` | Approved brand knowledge → embeddings → pgvector (idempotent) |
| `workflows/02_SEO_Article_Automation.json` | Orchestrator + per-keyword pipeline (self-calling sub-executions) |
| `workflows/03_Error_Recovery.json` | Error Trigger + 30-min reconciliation (leases, Docs ledger, Sheets sync) |
| `database/01…04_*.sql` | pgvector setup, knowledge schema, processing history, idempotency/recovery + least-privilege grants |
| `prompts/01…05_*.md` | Prompt creator, writer, evaluator, reviser, brand context policy (embedded into 02 at build time) |
| `configuration/` | `config.example.json`, `required_credentials.md`, `environment_variables.md` |
| `documentation/` | Setup, import, Sheets, Docs, Gemini, RAG, plagiarism, testing and architecture guides |
| `templates/google_sheets/` | Header templates for the three tabs (inert example rows) |
| `tools/` | Workflow generator, Code-node sources and shared libraries, structural validator, packager |
| `tests/` | Unit, database and end-to-end tests, plus the latest results in `tests/results/` |
| `dist/n8n-seo-automation.zip` | Packaged final files |

## Quick start

1. `documentation/SETUP_GUIDE.md`: the ordered checklist (≈1 hour).
2. `documentation/N8N_IMPORT_GUIDE.md`: import, credentials, configuration
   IDs, error-workflow wiring.
3. Run the manual tests in `documentation/TESTING_AND_TROUBLESHOOTING.md`
   before activating the schedules. Activate 03 → 01 → 02.

## Status (honest summary)

| Component | Status |
|---|---|
| All three workflows | IMPLEMENTED · STRUCTURALLY_VALIDATED · IMPORTED (n8n 2.44.6) · EXECUTED_SUCCESSFULLY against real PostgreSQL/pgvector with **mocked** external APIs (30/30 e2e tests) |
| PostgreSQL schema | EXECUTED_SUCCESSFULLY (PostgreSQL 16.15 + pgvector 0.6.0; idempotent re-apply; concurrency test) |
| Live Gemini, DupliChecker, Google Sheets/Docs | NOT_YET_TESTED: needs your credentials. See the acceptance tests |

Developer commands (Node ≥ 20; n8n 2.x CLI for e2e):

```bash
npm run build      # regenerate workflows/ from tools/ + prompts/
npm run validate   # structural validation against n8n 2.44.6 node definitions
npm run test:unit
PGDB=seo_selftest npm run test:db        # uses a THROWAWAY database
N8N_BIN=$(which n8n) npm run test:e2e
npm run package    # rebuild dist/n8n-seo-automation.zip
```

No secrets are stored in this folder. All API keys, OAuth tokens and database
passwords are n8n credentials.
