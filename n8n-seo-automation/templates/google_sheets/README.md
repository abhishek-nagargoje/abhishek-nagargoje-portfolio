# Google Sheets templates

Import each CSV as its own tab, named exactly `Keywords`, `Brand_Knowledge` and
`Article_Log`. Use *File → Import → Upload → Insert new sheet(s)*, then rename.

The example rows are deliberately inert:

* `Keywords` example rows have `Status = DRAFT`, so they are never processed.
  The `example.com` URLs are illustrative, not real pages.
* `Brand_Knowledge` rows are placeholders with `Approved = FALSE`. Replace them
  with verified company information, then set `Approved = TRUE`. The automation
  never invents company facts, so an empty or placeholder knowledge base means
  articles go to `REVIEW_REQUIRED`.

See `documentation/GOOGLE_SHEETS_SETUP.md` for the column rules.
