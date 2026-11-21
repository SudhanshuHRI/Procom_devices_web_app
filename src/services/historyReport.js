export function historyReport(records, key, title) {
  return records.map((record) => ({
    'No.': record.sno,
    'Date and time': record.time,
    [title]: record[key],
  }));
}
