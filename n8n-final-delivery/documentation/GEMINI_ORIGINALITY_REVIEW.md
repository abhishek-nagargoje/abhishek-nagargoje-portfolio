# Variant: `02_SEO_Article_Automation_Gemini_Review.json`

Workflow name: **HR Remedy India - SEO Article Automation (Gemini Originality Review)**.
Same as `02_SEO_Article_Automation.json` except that the DupliChecker API is
replaced by a Gemini AI originality review using the existing
`Google Gemini(PaLM) Api account` credential. **No DupliChecker credential is
needed.** Import only one of the two article workflows (or keep the other
inactive).

## Approval rule
No external plagiarism check is performed, so **nothing is approved
automatically**. An article that passes the E-E-A-T editorial check and the
AI originality review is written to a separate Google Doc,
**"HR Remedy India — SEO Articles Pending Human Review"** (created
automatically; ID stored in PostgreSQL under `review_doc`), and finalised as
**REVIEW_REQUIRED** with the reason "Human review required before
publication". The approved library document is never written by this variant.
The document section and the sheet rows state that the result is an AI review
only, with no plagiarism percentage.

Re-queuing a row (Status READY) after review does not regenerate or duplicate
anything: the run finds the article's marker in the review document and keeps
the row REVIEW_REQUIRED. Publication remains a human decision outside the
workflow.

## What the Gemini Originality Review does
After the E-E-A-T evaluation, Gemini compares the article **only** with
material the workflow already holds: the target page text (first 8 000
characters, `originality_page_excerpt_chars`) and the retrieved brand-knowledge
records. It checks repetitive wording, copied-looking passages, similarity to
the target page and source material, original value, unsupported claims and
missing attribution, and sentences to rewrite. It returns JSON:
`status` (PASS / FAIL / REVIEW_REQUIRED), `review_notes`, `flagged_phrases`,
`suggested_rewrites`, `sources_compared` and `limitations`.

Safeguards:
* The output is rejected (one corrective retry, then REVIEW_REQUIRED) if it
  contains a plagiarism/similarity/originality percentage or score, or claims
  an internet or plagiarism-database scan.
* Three fixed limitation statements are always stored ("AI review only…", "No
  internet search and no external plagiarism database…", "A passing AI review
  is not a verified plagiarism check…").
* Acceptance: status PASS **and** no flagged passage of type copied_looking,
  similar_to_target_page, similar_to_source_material, unsupported_claim,
  missing_attribution or low_original_value. Pure repetition notes do not block.
* A FAIL goes into the existing revision loop (max 3 attempts). The reviser
  receives the flagged passages and suggested rewrites, and every revision is
  re-validated, re-evaluated (E-E-A-T) and re-reviewed.

## Article_Log
| Column | Value |
|---|---|
| `Plagiarism_Percent` | always blank (no external score exists) |
| `Plagiarism_Status` | `AI_REVIEW_PASS` (AI review passed, awaiting human review), `AI_REVIEW_FAIL` (failed after the last attempt), `REVIEW_REQUIRED` (Gemini returned REVIEW_REQUIRED, or its output was invalid/unavailable), `AI_REVIEW_ONLY` (fallback when the run ended before a verdict was recorded) |
| `Plagiarism_Report_URL` | always blank |
| `Status` | `REVIEW_REQUIRED` (never `APPROVED`) |
| `Google_Doc_URL` | link to the pending-review document when the article was written there |

## Changes compared with `02_SEO_Article_Automation.json`
**Nodes removed (17):** Check DupliChecker Account, Validate DupliChecker
Account, Prepare Plagiarism Submission, Within Plagiarism Word Limit?, Submit
Plagiarism Check, Parse Plagiarism Submission, Submission Route, Record
Plagiarism Submission, Prepare Plagiarism Polling, Needs Polling?, Wait Before
Poll, Retrieve Completed Plagiarism Report, Evaluate Plagiarism Poll, Poll
Route, Check Plagiarism Acceptance Criteria, Record Plagiarism Result, Finalize
Approved Job.

**Nodes added (10):** Build Originality Review Request, Record Originality
Review Start, Originality Review Request, Gemini Originality Review, Validate
Originality Review, Originality Review Route, Check Originality Acceptance
Criteria, Record Originality Result, Require Human Review, Finalize Pending
Human Review.

**Nodes with changed parameters (8):** Configuration (no DupliChecker
settings; review document; `external_plagiarism_check_performed: false`),
Validate Configuration, Check Schema & Settings (context now from *Resolve
Gemini Models*; runtime config without DupliChecker), Load Master Doc Setting
and Save Master Doc ID (use `review_doc`), Read Me, Lane 3, Lane 4.

**Connections added (all others unchanged):**
* Resolve Gemini Models → Ensure Database Schema (replaces the DupliChecker preflight)
* Record Editorial Result → Build Originality Review Request → Status Row: PLAGIARISM_CHECK → Sheet Status: PLAGIARISM_CHECK → Continue After PLAGIARISM_CHECK → Record Originality Review Start → Originality Review Request → Gemini Originality Review → Validate Originality Review → Originality Review Route
* Originality Review Route: VALID → Check Originality Acceptance Criteria → Record Originality Result → Pass / Revise / Human Review Decision; RETRY → Originality Review Request; FAIL → Prepare Unapproved Outcome
* Record Document Verified → Require Human Review → Finalize Pending Human Review → Prepare Sheet Updates

Unchanged: claim/lease logic, database event logging (the AI review is
recorded through the same `PLAG_SUBMITTED`/`PLAG_RESULT` events with provider
`gemini_originality_review` and no percentage, so the PostgreSQL approval gate
still requires a completed review of the exact current text), retries and
corrective retries, prompt and article generation, the E-E-A-T evaluation, the
revision loop, Google Sheets progress and final updates, Google Docs
formatting/ledger/marker protection, and the Error Recovery workflow.

## Shared components updated (backward compatible)
* `database/04_idempotency_and_recovery.sql`: stores the reviewer in
  `seo_plagiarism_checks.provider`; new `seo_set_doc_setting()` for the review
  document. Existing behaviour unchanged (all 47 SQL tests pass).
* Docs formatting, sheet rows, reviser input and the Error Recovery
  reconciliation rows show AI-review labels when the reviewer is
  `gemini_originality_review`; DupliChecker runs behave exactly as before.

## Test results (MOCKED Gemini, Sheets, Docs and website; real n8n engine and PostgreSQL)
`tests/run_e2e_gemini_review.js` — **25/25 on n8n 2.44.6 and 25/25 on 1.123.87**, run with **no
DupliChecker credential**: AI FAIL → revision → both checks again → PASS → review
document → REVIEW_REQUIRED; Article_Log blank percent/URL and AI labels;
re-queue without regeneration or duplication; percentage/"internet scan"
claims rejected with one corrective retry; invalid review output fails safely;
max-attempt limit with AI_REVIEW_FAIL. Structural validation passes for both n8n
versions. CLI import binds all 40 credential references (Postgres, Sheets,
Docs, Gemini only).

**Not tested live:** the real Gemini API (prompt quality and JSON compliance of
the actual model), Google Sheets, Google Docs and your PostgreSQL server.

## Limitations
* This is **not** plagiarism detection. Gemini compares only the target page
  excerpt and retrieved brand records; it cannot detect copying from any other
  website or publication. Human review (and, if required, an external
  plagiarism tool) is needed before publication.
* AI judgements can be wrong in both directions (missed similarity, false
  flags); the workflow fails closed but cannot prove originality.
* Only the first 8 000 characters of the target page are compared.
* The workflow never sets APPROVED; marking an article approved/published is
  a manual decision outside the workflow.
