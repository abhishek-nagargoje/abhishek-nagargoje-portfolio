// Recovery configuration - NON-SECRET. Must match the article workflow.
const config = {
  SPREADSHEET_ID: 'REPLACE_WITH_GOOGLE_SPREADSHEET_ID',
  KEYWORDS_SHEET: 'Keywords',
  ARTICLE_LOG_SHEET: 'Article_Log',
  MASTER_DOC_ID: 'REPLACE_WITH_MASTER_GOOGLE_DOC_ID',
  DOCS_API_BASE: 'https://docs.googleapis.com/v1',
  MAX_TECHNICAL_FAILURES: 3,
  RECONCILE_MIN_AGE_MINUTES: 15,
  TIMEZONE: 'Asia/Kolkata',
};
for (const k of ['SPREADSHEET_ID', 'MASTER_DOC_ID']) {
  if (String(config[k]).startsWith('REPLACE_WITH')) throw new Error(`CONFIGURATION: ${k} is not configured in "Recovery Configuration"`);
}
return [{ json: { config, now_ist: DateTime.now().setZone(config.TIMEZONE).toFormat('yyyy-LL-dd HH:mm:ss') } }];
