# Required credentials

All secrets are stored as **n8n credentials** (encrypted with the instance's
`N8N_ENCRYPTION_KEY`). None appear in the workflow JSON, Google Sheets, prompts,
logs or this repository. The exported workflows reference placeholder
credential IDs such as `REPLACE_GEMINI_CREDENTIAL_ID`. After import, open each
affected node, or use **Credentials → select** in the node panel, and pick the
real credential. n8n then stores the real ID.

| # | n8n credential type | Suggested name | Used by | What to enter |
|---|---|---|---|---|
| 1 | **Postgres** | `SEO Postgres (pgvector)` | all Postgres nodes in 01, 02, 03 | Host, port, database, user `n8n_seo_app`, its password, SSL mode |
| 2 | **Header Auth** (`httpHeaderAuth`) | `Gemini API Key (x-goog-api-key)` | Gemini + embedding HTTP nodes in 01, 02 | **Name:** `x-goog-api-key` · **Value:** your Gemini API key |
| 3 | **Query Auth** (`httpQueryAuth`) | `DupliChecker API Token` | `Preflight - Verify Plagiarism Account`, `Submit Plagiarism Scan`, `Retrieve Plagiarism Report` in 02 | **Name:** `token` · **Value:** your DupliChecker API token |
| 4 | **Google Sheets OAuth2 API** | `Google Sheets OAuth2 (SEO)` | every Google Sheets node in 01, 02, 03 | OAuth client ID/secret from Google Cloud; sign in with the account that owns the spreadsheet |
| 5 | **Google Docs OAuth2 API** | `Google Docs OAuth2 (SEO)` | Docs HTTP nodes in 02 and 03 (`Get Master Doc`, `Append Article to Master Google Doc`, `Read Master Doc For Verification`, `Read Master Doc`) | OAuth client ID/secret; sign in with an account that can **edit** the master doc |

## Minimum permissions

* **PostgreSQL:** use the role `n8n_seo_app` created by
  `database/01_pgvector_setup.sql`. It is granted only `USAGE` on schema `seo`,
  `SELECT/INSERT/UPDATE` on its tables, sequence usage and `EXECUTE` on its
  functions (`04_idempotency_and_recovery.sql`). It has no `DELETE`, no DDL and no
  superuser rights. Set its password with `\password n8n_seo_app`.
* **Gemini API key:** create it in Google AI Studio for a project used only by
  this automation. Restrict the key to the Generative Language API, and to the
  VPS IP address if your plan supports it.
* **DupliChecker:** the API token is shown on your DupliChecker profile page
  **after purchasing a plan that includes API access**. A website subscription
  does not automatically include API access; confirm it with the account
  status check (see `documentation/PLAGIARISM_API_SETUP.md`).
* **Google OAuth:** the n8n Google Sheets credential requests spreadsheet scope.
  The Google Docs credential requests the Docs/Drive scopes n8n defines for
  that credential type. Sign in with a dedicated service user that has **edit**
  access only to the automation spreadsheet and the master document. Do not
  share the master document publicly.

## Why Query Auth for DupliChecker?

DupliChecker's documentation shows a `token` field sent with each request.
n8n's HTTP Request node cannot place a credential value into a form-urlencoded
body, because Custom Auth `body` values are merged after the form is built. Query
Auth keeps the token in the credential store and sends it as `?token=…`. The
workflow's preflight (`Preflight - Verify Plagiarism Account`) confirms that
DupliChecker accepts it before any article is scanned. If your account rejects
query-string tokens, see the alternatives in
`documentation/PLAGIARISM_API_SETUP.md#authentication-fallbacks`.
