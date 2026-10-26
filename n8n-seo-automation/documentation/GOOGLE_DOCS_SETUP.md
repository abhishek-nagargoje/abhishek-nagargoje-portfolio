# Google Docs setup (approved-article destination)

## 1. Create the master document

1. Create one Google Doc, for example "KARGAR – Approved SEO Articles". It can be
   empty or have a cover page.
2. Copy its ID from `https://docs.google.com/document/d/<ID>/edit` into
   `MASTER_DOC_ID` in **02 `Workflow Configuration`** and in both **03**
   configuration nodes.
3. Share it only with the Google account used by the n8n **Google Docs OAuth2**
   credential (Editor) and with your editors. **Do not share it publicly.**

Only articles that passed every mandatory check are appended. Failed or
review-required articles stay in PostgreSQL (`seo.article_attempts`,
`seo.v_review_queue`) and the `Article_Log` tab.

## 2. What each appended section looks like

Every article is a separate section that starts on a new page:

* **Title** (Title style): the article title
* Metadata lines (bold labels): Article ID, Target page URL (clickable),
  Primary keyword, Supporting keywords, SEO title, H1, Meta description,
  Suggested URL slug, Generation date (IST), Editorial quality status,
  Plagiarism result, Plagiarism report reference
* A small grey marker line, `SEO-ARTICLE-MARKER: ART-YYYYMMDD-XXXXXXXXXX`,
  used for idempotency and reconciliation. Keep it in the document.
* The article body. `#` → Heading 1, `##` → Heading 2, `###` → Heading 3,
  paragraphs → Normal text, `-`/`*` lists → bulleted lists, `1.` lists →
  numbered lists, `**bold**` and `*italic*`, and `[text](url)` → clickable
  links (internal and external)
* **Frequently Asked Questions** (Heading 2, questions as Heading 3), added
  from `Suggested_FAQs` when the body does not already contain an FAQ section
* **References** (Heading 2): a bulleted list of `External_Sources` with
  clickable titles

Markdown tables are written as readable text rows. Native Docs tables are not
created.

## 3. How the write works (verified against the Docs API v1 behaviour)

The Google Docs native n8n node can insert text but cannot apply heading
styles or links. The workflow therefore calls the REST API through HTTP
Request nodes that use the **Google Docs OAuth2** credential
(`predefinedCredentialType: googleDocsOAuth2Api`):

1. `GET /v1/documents/{id}` → current end index and `revisionId`. The doc is
   also searched for the marker first; if it is already there, no write
   happens.
2. `POST /v1/documents/{id}:batchUpdate` with one `insertText` (complete
   section), `updateParagraphStyle` (named styles), `createParagraphBullets`,
   `updateTextStyle` (bold, italic, links, marker styling) and
   `insertPageBreak`. All indices are UTF-16 offsets, computed from the text
   actually inserted. `writeControl.requiredRevisionId` makes Google reject
   the update if the document changed since step 1. The append is never
   retried blindly.
3. `GET` again → the marker must appear **exactly once**, followed by the
   article's final paragraph, before the article is marked `APPROVED`.

## 4. Idempotency and partial success

| Situation | What happens |
|---|---|
| Write succeeded, Sheets update failed | DB already says `APPROVED` with `sheet_synced = false`. **03 Error Recovery** re-syncs Sheets; the doc is not touched |
| Docs API returned an error or timeout but may have applied the change | Ledger → `UNCERTAIN`; the doc is re-read and the marker decides (VERIFIED or FAILED) |
| n8n crashed between write and DB update | Ledger stays `PENDING`. Error Recovery searches the doc for the marker after `RECONCILE_MIN_AGE_MINUTES`. If found → finalize; if not → `FAILED`, and the keyword is re-queued |
| Same article reaches the write step again | `begin_doc_write()` returns `ALREADY_WRITTEN` or `RECONCILE`; never a second append |
| Two executions approve articles at the same time | A lease lock (`seo.doc_locks`) serialises writers. The revision check is a second guard |

## 5. Size considerations

Each verification reads the whole document. A master document with several
hundred long articles becomes slow to read. When the document gets large
(roughly 300+ articles or ~1.5 million characters), create a new master
document and change `MASTER_DOC_ID`. Earlier articles stay where they are, and
their ledger rows keep the original `doc_id`.
