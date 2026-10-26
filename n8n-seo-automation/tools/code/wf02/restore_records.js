// The Google Sheets update node returns the written cells, not our record.
// Re-emit the original records (same order) so the sub-execution receives them.
return $('Keyword ID Generated?').all(0).map((i) => ({ json: i.json }));
