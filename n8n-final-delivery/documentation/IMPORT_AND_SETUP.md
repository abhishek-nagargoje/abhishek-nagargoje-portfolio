# Import and setup — HR Remedy India SEO automation

Target: your self-hosted n8n on the Hostinger VPS (container `n8n-q49p-n8n-1`,
network `n8n-q49p_default`) with the existing PostgreSQL container
`seo-postgres` (database `seo_content`, user `seo_n8n`, pgvector installed).
Nothing in this package creates another database server, changes n8n's own
database, or exposes port 5432.

Compatibility: the workflows use only core nodes in versions that exist in
both n8n **1.123.x** and **2.44.x** (Code v2, IF v2, Switch v3, Wait v1.1,
Split in Batches v3, Schedule Trigger v1.2, HTTP Request v4.2, Postgres v2.5,
Google Sheets v4.5, Error Trigger v1, Manual Trigger v1, Sticky Note v1). They
were imported and executed on both versions (see TESTING_AND_TROUBLESHOOTING.md).
To see your version: n8n → *Help → About n8n*, or on the VPS:
`docker exec n8n-q49p-n8n-1 n8n --version`.

---

## Step 0 — Credentials (one time)
Read `configuration/required_credentials.md`. In short:

| Credential name (exact) | Type | Action |
|---|---|---|
| `SEO PostgreSQL` | Postgres | exists — nothing to do |
| `Google Sheets account` | Google Sheets OAuth2 API | exists — nothing to do |
| `Google Docs account` | Google Docs OAuth2 API | exists — **rename to this exact name if yours differs** |
| `Google Gemini(PaLM) Api account` | Google Gemini(PaLM) API | exists — **rename to this exact name if yours differs** |
| `DupliChecker API` | Custom Auth | **create**: JSON `{"body": {"token": "<your DupliChecker API token>"}}` |

Renaming before import is the fastest route: n8n then binds every node
automatically when the workflow is saved. (If you prefer not to rename, open
each node listed in `required_credentials.md` once and pick the credential.)

## Step 1 — Import the three workflows
For each file in `workflows/`, in this order:
1. `01_Brand_RAG_Ingestion.json`
2. `02_SEO_Article_Automation.json`
3. `03_Error_Recovery.json`

n8n → **Overview → Create workflow** (empty canvas) → **⋯ menu (top right) →
Import from File…** → choose the file → **Save** (Ctrl/Cmd + S).

After saving, nodes whose credential was found show no warning. A red
credential warning means the name did not match: open that node and select
the credential (the choice is stored with the workflow).

All three workflows stay **inactive** after import. The daily schedule
(08:00 Asia/Kolkata) in workflow 02 and the 30-minute sweep in workflow 03
are **disabled** nodes until you enable them (Step 6).

## Step 2 — Connect the error workflow (one setting)
Open **HR Remedy India - SEO Article Automation → ⋯ → Settings → Error
workflow → HR Remedy India - Error Recovery → Save**.

**n8n 2.x only:** n8n 2.x runs an error workflow only if it is **published**
(verified in the n8n 2.44.6 source and by test). Open *HR Remedy India - Error
Recovery* and click **Publish**. This is safe: its 30-minute schedule node is
disabled, so it does nothing until an error occurs or you run the sweep. On
n8n 1.x activation is not required.

## Step 3 — Check the Configuration nodes (normally no edits)
Each workflow has exactly one node named **Configuration** holding all
settings. Defaults already match your environment:
* spreadsheet ID `171UZWnNYKReJSQjqmW6QPA_Hptu_usIS25wq589z8Mg`, tabs
  `Keywords`, `Brand_Knowledge`, `Article_Log` (headers are used exactly as
  they exist; nothing is renamed, no header is overwritten, no column is added);
* brand HR Remedy India, `https://www.hrremedyindia.com/`, allowed target
  domain `hrremedyindia.com`;
* `gemini-embedding-001`, 768 dimensions; text model `auto`;
* max 3 attempts, plagiarism threshold 10 %, polling every 20 s up to 10 min;
* master document title "HR Remedy India — SEO Article Library" (created
  automatically, ID stored in PostgreSQL — you never enter a document ID).

The spreadsheet ID could not be validated from the build environment (the
Google account available there cannot see this spreadsheet). It is therefore
stored once per workflow in the Configuration node, and workflow 02 refuses to
run if it differs from the ID first stored in PostgreSQL by workflow 01, so a
typo cannot silently send data elsewhere.

## Step 4 — Load the brand knowledge (workflow 01)
1. In the `Brand_Knowledge` tab, add **verified** HR Remedy India information:
   one topic per row (company profile, each real service, FAQs, target
   audiences, brand voice, internal page URLs …). Fill `Knowledge_ID` (unique,
   e.g. `KB-001`), `Category`, `Content` (≤ 7 000 characters — split longer
   topics into several rows), `Source_URL` (the page on hrremedyindia.com the
   fact comes from), `Approved` = **TRUE** only after you have checked it,
   `Last_Updated`.
   Only content you approve is ever used; the workflows never invent company
   facts and never use KARGAR Facility Management or any other company's text.
2. Open **HR Remedy India - Brand RAG Ingestion** → **Execute workflow**.
3. The last node, *Ingestion Result*, shows inserted / updated / unchanged /
   skipped / failed counts and the number of active records. Running it again
   creates no duplicates (unchanged rows are not re-embedded); rows whose
   `Approved` is no longer TRUE are deactivated.

The first run also creates all database tables and functions (no SQL editor
needed). If you prefer to create them by hand first, run the four files in
`database/` in order with
`docker exec -i seo-postgres psql -U seo_n8n -d seo_content < database/01_pgvector_setup.sql`
(and 02, 03, 04) — the result is identical.

## Step 5 — First article (workflow 02, manual test)
1. In `Keywords`, add one row: `Keyword_ID` (unique, e.g. `KW-001`),
   `Target_Page_URL` (an existing https page on www.hrremedyindia.com),
   `Primary_Keyword`, optional `Supporting_Keywords` (comma separated),
   `Search_Intent`, `Target_Audience`, `Target_Location`, `Language`,
   `Priority` (1/2/3 or High/Medium/Low), **`Status` = READY**.
2. Open **HR Remedy India - SEO Article Automation** → **Execute workflow**.
   A full run with one revision takes several minutes (three to seven Gemini
   calls plus DupliChecker polling).
3. Watch `Status` move through PROCESSING → PROMPT_CREATED →
   ARTICLE_GENERATED → QUALITY_REVIEW → PLAGIARISM_CHECK (→ REVISION_REQUIRED
   …) → **APPROVED** (or REVIEW_REQUIRED / ERROR with the reason in
   `Last_Error`).
4. When APPROVED: `Article_Log` has the row (with `Google_Doc_URL`) and the
   article is a new section of **HR Remedy India — SEO Article Library** in
   the Google Drive of the Google Docs credential's account.
5. The last node, *Final Result*, summarises the run (status, attempts,
   reports, document link, model used).

One keyword is processed per execution. Run it again for the next READY row.

## Step 6 — Go live
Only after the manual test succeeded:
* workflow 02: open node **Daily Schedule 08:00 IST** → enable it (right-click
  → *Activate* / toggle "Deactivate" off), then **activate the workflow**.
  To process more than one keyword per day, change the schedule rule (e.g.
  every 2 hours between 08:00 and 18:00) — each run still processes exactly
  one keyword and parallel runs cannot pick the same row;
* workflow 03: optionally enable **Every 30 Minutes** and activate it (the
  Error Trigger works without activation).

## DupliChecker notes
* The documented contract is used: `POST /api/info`, `POST /api/checkplag`
  (`token`, `data`, `rephrased=true`) and `GET
  /api/query-footprint/{hash}/{key}` repeated while `recall` is true.
* The very first step of every run (`Check DupliChecker Account`) calls
  `/api/info`. If it reports that the token was rejected, see the JSON-vs-query
  fallback in `configuration/required_credentials.md` — that error stops the
  run before any keyword is claimed.
* `plagiarism_max_words` (5 000) should not exceed the per-request word
  limit of your plan; articles above it are not submitted and go to
  REVIEW_REQUIRED (never approved without a report).

## Security checklist
* No API key, token or password is stored in any workflow, Code node, SQL
  file, sheet or this documentation. The PostgreSQL password stays in the
  `SEO PostgreSQL` credential.
* Error texts are redacted (`key=`, `token`, `Bearer`, Google key patterns)
  before they are written to PostgreSQL.
* Target URLs are limited to `allowed_target_domains`.
