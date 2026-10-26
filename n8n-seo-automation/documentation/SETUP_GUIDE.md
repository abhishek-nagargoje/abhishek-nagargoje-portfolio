# Setup guide (Hostinger VPS)

Follow the steps in order. Each step links to the detailed guide.

## 0. Prerequisites

* n8n self-hosted on the VPS (2.44.6 tested), reachable over HTTPS (needed for
  the Google OAuth redirect).
* PostgreSQL with **pgvector ≥ 0.5.0** on the VPS. It must **not** be exposed
  to the internet. See `configuration/environment_variables.md`.
* A Google account dedicated to the automation (Sheets + Docs access only).
* A Gemini API key (Google AI Studio).
* A DupliChecker plan that includes **API access**, plus its API token.

## 1. Database (≈10 min)

Run `database/01…04` as the DB owner, then set the app role password.
Details: `RAG_SETUP.md#database-setup`. Optional self-test on a **throwaway**
database: `PGDB=seo_selftest tests/run_database_tests.sh`.

## 2. Google Sheets (≈10 min)

Create the spreadsheet with tabs `Keywords`, `Brand_Knowledge`, `Article_Log`
from `templates/google_sheets/`. Fill `Brand_Knowledge` with **verified**
company information and set `Approved = TRUE`. See `GOOGLE_SHEETS_SETUP.md`.

## 3. Google Docs (≈5 min)

Create the master document and keep it private. See `GOOGLE_DOCS_SETUP.md`.

## 4. Google OAuth credentials in n8n (≈15 min)

1. Google Cloud Console → a project → enable **Google Sheets API**, **Google
   Docs API** and **Google Drive API**.
2. OAuth consent screen (internal or testing; add your automation account as a
   test user).
3. Create an OAuth client ID (*Web application*). Redirect URI = the one shown
   in n8n's credential dialog (`https://<your-n8n>/rest/oauth2-credential/callback`).
4. In n8n create **Google Sheets OAuth2 API** and **Google Docs OAuth2 API**
   credentials with that client ID/secret, then *Sign in with Google*.

## 5. Gemini and DupliChecker credentials (≈5 min)

`GEMINI_API_SETUP.md` and `PLAGIARISM_API_SETUP.md`. Before production,
confirm the Gemini model IDs and the DupliChecker API details on the providers'
pages. The workflow verifies both at run time.

## 6. Import the workflows and wire them

`N8N_IMPORT_GUIDE.md`: import 01/02/03, select credentials, set configuration
IDs, and set 03 as the error workflow of 01 and 02.

## 7. Test before activating

`TESTING_AND_TROUBLESHOOTING.md#acceptance-tests-on-your-server`. Run the
ingestion, then one keyword, then five, reviewing each article in the master
document.

## 8. Activate

Activate 03 → 01 → 02. Daily runs: knowledge sync at 07:30 IST, articles at
08:00 IST, recovery every 30 min. Review `REVIEW_REQUIRED` items with
`SELECT * FROM seo.v_review_queue;`.

## Human publication

Nothing is published to the website. Approved articles are drafts in the
master Google Doc. An editor reviews them, adds genuine first-hand experience
where appropriate, and publishes manually.
