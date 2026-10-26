# Google Sheets setup

Create **one spreadsheet** (for example "KARGAR SEO Automation") with three tabs.
Tab names and header spellings must match exactly; they are case-sensitive.
Ready-to-import header files are in `templates/google_sheets/`. Use
*File → Import → Upload → Insert new sheet(s)*, then rename each tab.

Put the spreadsheet ID, the long string in
`https://docs.google.com/spreadsheets/d/<ID>/edit`, into `SPREADSHEET_ID` in
**all four** configuration nodes:

* 01 `Ingestion Configuration`
* 02 `Workflow Configuration`
* 03 `Recovery Configuration`
* 03 `Recovery Configuration (Error Path)`

Never put API keys or passwords in any tab.

## 1. `Keywords` (input queue)

| Column | Required | Notes |
|---|---|---|
| `Keyword_ID` | recommended | Unique, `[A-Za-z0-9_-.]`, max 64 characters. If blank, the workflow generates a deterministic ID (`KW-…`) and writes it back to the row |
| `Target_Page_URL` | **yes** | Absolute `https://` (or `http://`) URL of the page to support. Private, local and credential-bearing URLs are rejected. Optionally restrict hosts with `ALLOWED_TARGET_DOMAINS` |
| `Primary_Keyword` | **yes** | Never changed or reassigned by the workflow |
| `Supporting_Keywords` | no | Comma, semicolon or newline separated |
| `Search_Intent` | no | e.g. Informational / Commercial / Transactional. Inferred if blank and stated as inferred |
| `Target_Audience` | no | Inferred from the page if blank |
| `Target_Location` | no | e.g. Pune |
| `Language` | no | Default `English` |
| `Priority` | no | `High`/`Medium`/`Low` or a number (1 = first) |
| `Status` | **yes** | Set to `READY` to queue the row. The workflow updates it |
| `Processing_Started_At` | written by workflow | IST timestamp |
| `Processed_At` | written by workflow | IST timestamp |
| `Last_Error` | written by workflow | Safe explanation, no secrets |
| `Regenerate` | optional extra column | `TRUE` authorises a **new** article for a row that is already `APPROVED` |

Only rows whose `Status` is exactly `READY` are processed. Rows with any other
status, including blank rows you are still drafting, are never touched.

**Deduplication policy.** A request is identified by brand + normalised keyword
+ normalised target URL.

* The same combination under another Keyword_ID becomes `SKIPPED_DUPLICATE`.
* An already approved row set back to `READY` stays `APPROVED`, with a note. No
  duplicate article or document insert is made unless `Regenerate = TRUE`.
* The same keyword with a **different** URL is processed separately, and a
  cannibalisation warning is logged.

Status values are explained in `WORKFLOW_ARCHITECTURE.md#status-model-keywords-sheet`.

## 2. `Brand_Knowledge` (RAG source)

| Column | Required | Notes |
|---|---|---|
| `Knowledge_ID` | **yes** | Persistent, unique ID (e.g. `KB-001`). Changing it creates a new record |
| `Category` | **yes** | One of `COMPANY_PROFILE, SERVICES, SERVICE_AREAS, BRAND_VOICE, VERIFIED_ACHIEVEMENTS, APPROVED_CLAIMS, TECHNICAL_EXPERTISE, CUSTOMER_FAQS, TARGET_AUDIENCE, INTERNAL_LINKS, COMPANY_PROCESSES, CONTACT_INFORMATION` (edit `ALLOWED_CATEGORIES` to extend) |
| `Content` | **yes** | One self-contained, verified fact or guideline (≥ 20 characters). Long text is split into chunks of up to 3,000 characters automatically |
| `Source_URL` | no | Where the fact is documented (absolute http(s) URL) |
| `Approved` | **yes** | Only `TRUE` / `YES` / `1` / `APPROVED` rows are embedded. Setting a row back to anything else deactivates it in the knowledge base on the next sync (soft, not deleted) |
| `Last_Updated` | no | Free text/date, stored for audit |

Rules for content:

* Write only facts that are **verified and approved** by the company: services,
  service areas, processes, contact details, approved claims, brand voice.
* Do **not** add statistics, client names, awards, certifications or
  guarantees unless they are documented and approved. If such a fact is
  missing, the article simply won't mention it. The workflow never invents it.
* Put internal pages the writer may link to in `INTERNAL_LINKS` rows, with the
  full URL in `Content`.

## 3. `Article_Log` (history)

Header row (exact):

`Article_ID, Keyword_ID, Target_Page_URL, Primary_Keyword, Article_Title, SEO_Title, Meta_Description, URL_Slug, Quality_Status, EETA_Report, Plagiarism_Percent, Plagiarism_Status, Plagiarism_Report_URL, Attempts, Google_Doc_ID, Google_Doc_URL, Status, Error, Created_At, Updated_At`

* Rows are written with *append or update* keyed on `Article_ID`, so a retry
  never creates duplicate log rows.
* `EETA_Report` holds a compact status summary. The full evaluator reports, all
  attempts and the plagiarism reports are kept in PostgreSQL
  (`seo.article_attempts`) for human review.
* `Plagiarism_Report_URL` is the provider's report URL when one is returned,
  otherwise a database reference such as
  `postgres:seo.article_attempts/<Article_ID>/<attempt>`.

## Optional `Settings` tab

The workflows deliberately keep configuration in the configuration Code nodes,
which are versioned with the workflow. A Settings tab is not read. That
avoids accidental edits by sheet users changing thresholds or model IDs.

## Permissions

Share the spreadsheet only with the Google account used by the n8n Google
Sheets OAuth2 credential (Editor), plus the people who manage the queue.
