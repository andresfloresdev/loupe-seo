// CSV with a UTF-8 BOM (so Excel and Numbers read accents correctly) and
// formula-injection guarding: page text is untrusted, and a cell starting with
// = + - @ would run as a formula in a spreadsheet.

function cell(value) {
  let s = value == null ? '' : String(value);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  if (/[",\r\n]/.test(s)) s = `"${s.replace(/"/g, '""')}"`;
  return s;
}

// columns: [{ key, label }] ; rows: array of objects
export function toCSV(rows, columns) {
  const lines = [columns.map((c) => cell(c.label)).join(',')];
  for (const row of rows) {
    lines.push(columns.map((c) => cell(typeof c.key === 'function' ? c.key(row) : row[c.key])).join(','));
  }
  return '\uFEFF' + lines.join('\r\n') + '\r\n';
}

export function csvFilename(kind, pageUrl) {
  let host = 'page';
  try {
    host = new URL(pageUrl).hostname.replace(/^www\./, '');
  } catch {}
  const d = new Date();
  const stamp = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  return `${host}-${kind}-${stamp}.csv`.replace(/[^a-z0-9.\-_]/gi, '_');
}
