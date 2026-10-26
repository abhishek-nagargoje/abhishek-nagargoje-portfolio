// @mode all
// One item per invalid READY row (matched on row_number because Keyword_ID
// may be blank or duplicated). Returns no items when there is nothing to mark.
const rows = $input.first().json.invalid_rows || [];
return rows.map((r) => ({ json: r, pairedItem: { item: 0 } }));
