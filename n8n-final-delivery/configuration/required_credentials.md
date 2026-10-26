# Required n8n credentials

The workflows reference credentials **by name** (the exported JSON carries
`"id": null` and a name, never a credential ID from another n8n instance).
When you import a workflow and save it, n8n binds each reference to your
existing credential that has **the same name and type** — exactly one match is
required. This was verified with `n8n import:workflow` on n8n 1.123.87 and
2.44.6, and by "Import from File" in the n8n 2.44.6 editor (see
`documentation/TESTING_AND_TROUBLESHOOTING.md`).

If one of your credentials has a different name, either rename the credential
in n8n (*Credentials → open → rename*) to the name below **before** importing,
or open each listed node once after importing and select it. The selection is
saved; you never reconnect for later runs.

| # | Expected name (exact) | n8n credential type (internal name) | Already exists? | Used by |
|---|---|---|---|---|
| 1 | `Google Sheets account` | Google Sheets OAuth2 API (`googleSheetsOAuth2Api`) | Yes (named as required) | WF1: Read Brand_Knowledge Sheet · WF2: Read Keywords Sheet, Mark Invalid Keyword Rows, Mark Skipped Duplicates, Update Keyword Progress, Update Article_Log, Update Keywords Status · WF3: Reconcile Article_Log, Reconcile Keywords Status, Update Keyword Status |
| 2 | `Google Docs account` | Google Docs OAuth2 API (`googleDocsOAuth2Api`) | Yes — **check the name** (n8n's default name is `Google Docs account`) | WF2: Fetch Master Doc, Create Master Google Doc, Append Approved Article, Verify Document Write |
| 3 | `Google Gemini(PaLM) Api account` | Google Gemini(PaLM) API (`googlePalmApi`) | Yes — **check the name** (n8n's default name) | WF1: List Gemini Models, Generate Embedding · WF2: Check Gemini Models, Generate Query Embedding, Gemini Call 1: Create Article-Writing Prompt, Gemini Call 2: Generate Complete Article, Gemini Article Reviser, Gemini Editorial Evaluator |
| 4 | `SEO PostgreSQL` | Postgres (`postgres`) | Yes (named as required) | All PostgreSQL nodes in WF1, WF2, WF3 |
| 5 | `DupliChecker API` | **Custom Auth** (`httpCustomAuth`) | **No — create it** (below) | WF2: Check DupliChecker Account, Submit Plagiarism Check · WF3: none (report polling needs no token) |

## 1. Google Sheets account (existing)
Nothing to change. It must be able to read and edit spreadsheet
`171UZWnNYKReJSQjqmW6QPA_Hptu_usIS25wq589z8Mg`
("HR Remedy India - SEO Content Automation").

## 2. Google Docs account (existing)
Used through the HTTP Request node with *Predefined Credential Type → Google
Docs OAuth2 API* (this is how n8n lets the Google Docs credential call the
Docs REST API for heading styles, hyperlinks and atomic batch updates, which
the Google Docs node does not expose).
* n8n's Google Docs OAuth2 credential requests the scopes
  `https://www.googleapis.com/auth/documents`, `https://www.googleapis.com/auth/drive`
  and `https://www.googleapis.com/auth/drive.file`; `documents` is required
  to create and edit the master document.
* The master document **"HR Remedy India — SEO Article Library"** is created
  automatically on the first approved article in the Drive of the Google
  account connected to this credential. Its ID is stored in PostgreSQL
  (`seo_settings`, key `master_doc`). You never type a document ID.
* If the account cannot create or edit documents the workflow stops with a
  message naming the HTTP status and the scope above.

## 3. Google Gemini(PaLM) Api account (existing)
* Fields: **Host** = `https://generativelanguage.googleapis.com` (default),
  **API Key** = your Google AI Studio key.
* The workflows call the Gemini REST API through the HTTP Request node with
  *Predefined Credential Type → Google Gemini(PaLM) Api*. n8n adds the key to
  each request at run time; it is never stored in the workflow, a Code node,
  the sheet or the database. (n8n's Gemini credential sends the key as the
  `key` request parameter, which is Google's documented method; error texts
  are redacted before they are stored.)
* Why HTTP instead of the native Gemini nodes: the native *Embeddings Google
  Gemini* node cannot set `outputDimensionality` (required: 768) and only
  works attached to a vector-store node; the native *Message a Model* node is
  missing on older n8n 1.x builds and its simplified output hides
  `finishReason`/safety blocks that the fail-closed validation relies on.
* Models: `gemini-embedding-001` with `outputDimensionality: 768`. Text model:
  `auto` (default) selects the newest **stable** `gemini-<version>-flash` that
  your key can use, verified against the live ListModels response at the
  start of every run. To pin a model, set `gemini_text_model` in the
  Configuration node.

## 4. SEO PostgreSQL (existing)
Host `seo-postgres`, port `5432`, database `seo_content`, user `seo_n8n`
(password already stored in the credential, SSL as you configured it). The
schema is created/updated automatically (idempotently) by the *Ensure Database
Schema* node at the start of workflows 1 and 2. The `vector` extension must
already be installed in `seo_content` (it is: pgvector 0.8.7).

## 5. DupliChecker API (create once)
1. n8n → **Credentials → Add credential → search "Custom Auth"** (type
   `httpCustomAuth`).
2. **Name:** `DupliChecker API` (exactly).
3. **JSON:**
   ```json
   {"body": {"token": "PASTE-YOUR-DUPLICHECKER-API-TOKEN-HERE"}}
   ```
   (the token from your DupliChecker dashboard; n8n stores it encrypted and
   redacts it in the UI).
4. Save.

How it is sent: n8n merges `body.token` into the request body of *Check
DupliChecker Account* (`POST https://www.duplichecker.com/api/info`) and
*Submit Plagiarism Check* (`POST https://www.duplichecker.com/api/checkplag`
with `data` and `rephrased=true`). With Custom Auth, n8n sends that body as
**JSON** (`Content-Type: application/json`) — verified on n8n 2.44.6; a
multipart body would silently drop the token, so it is not used. The report
callback `GET https://www.duplichecker.com/api/query-footprint/{hash}/{key}`
is called without the token.

**If DupliChecker rejects JSON requests** (the *Check DupliChecker Account*
node then stops the run before anything is claimed with "DupliChecker
rejected the API token"), change the credential JSON to send the token as a
request parameter instead:
```json
{"qs": {"token": "PASTE-YOUR-DUPLICHECKER-API-TOKEN-HERE"}}
```
This keeps the token in the credential (not in the workflow), but it then
travels in the request URL over HTTPS; prefer the `body` form if it works.

## Error workflow (one setting, not a credential)
Open **HR Remedy India - SEO Article Automation → Settings → Error workflow**
and select **HR Remedy India - Error Recovery**. (Workflow IDs differ between
n8n instances, so this cannot be pre-filled in the export.) On **n8n 2.x** also **Publish** the Error Recovery workflow — n8n 2.x does not run unpublished error workflows.
