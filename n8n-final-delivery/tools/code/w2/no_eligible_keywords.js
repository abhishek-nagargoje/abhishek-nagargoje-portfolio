// @mode all
const j = $input.first().json;
return [{ json: { status: 'NO_ELIGIBLE_KEYWORDS', message: j.message, summary: j.summary,
  invalid_rows_marked: (j.invalid_rows || []).map((r) => ({ row_number: r.row_number, Keyword_ID: r.Keyword_ID, error: r.Last_Error })) } }];
