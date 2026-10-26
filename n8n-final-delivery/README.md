# HR Remedy India — n8n SEO content automation (final delivery)

Import these three files into n8n (*⋯ → Import from File*), in this order:

| File | Workflow name | Purpose |
|---|---|---|
| `workflows/01_Brand_RAG_Ingestion.json` | HR Remedy India - Brand RAG Ingestion | approved `Brand_Knowledge` rows → Gemini embeddings (768 d) → PostgreSQL/pgvector |
| `workflows/02_SEO_Article_Automation.json` | HR Remedy India - SEO Article Automation | READY keyword → page analysis → RAG → Gemini prompt → Gemini article → editorial check → DupliChecker → revision (max 3) → master Google Doc → Article_Log / Keywords |
| `workflows/02_SEO_Article_Automation_Gemini_Review.json` | HR Remedy India - SEO Article Automation (Gemini Originality Review) | **alternative to 02 without DupliChecker**: Gemini AI originality review; passing articles go to a "Pending Human Review" doc as REVIEW_REQUIRED — see `documentation/GEMINI_ORIGINALITY_REVIEW.md` |
| `workflows/03_Error_Recovery.json` | HR Remedy India - Error Recovery | Error Trigger + recovery sweep: release failed jobs, reconcile sheets, collect late plagiarism reports |

Then follow **`documentation/IMPORT_AND_SETUP.md`** (about 10 minutes: one new
credential, one setting, two test runs).

| Folder | Contents |
|---|---|
| `workflows/` | the three importable workflow JSON files (the deliverable) |
| `database/` | the SQL the workflows run automatically (idempotent); optional manual setup |
| `configuration/` | `required_credentials.md` (exact credential mapping), `config.example.json` (reference of all settings) |
| `documentation/` | setup, architecture, testing and troubleshooting |
| `tests/` | structural validator, SQL tests, unit tests, mocked end-to-end harness, editor import test |
| `tools/` | `build_workflows.js` + Code-node sources used to generate `workflows/` (not needed for import) |

Status of verification (details in `documentation/TESTING_AND_TROUBLESHOOTING.md`):
imported and executed in real n8n 1.123.87 and 2.44.6 with a real
PostgreSQL/pgvector database; **Gemini, DupliChecker, Google Docs and Google
Sheets were mocked** — the live acceptance test on your server is the
remaining step.
