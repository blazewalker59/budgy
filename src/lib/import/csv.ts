/** A small RFC 4180 CSV reader: quoted fields, doubled quotes, CRLF. */

export function parseCsv(text: string): Array<Array<string>> {
  const rows: Array<Array<string>> = []
  let row: Array<string> = []
  let field = ''
  let quoted = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"'
          i++
        } else quoted = false
      } else field += c
    } else if (c === '"') quoted = true
    else if (c === ',') {
      row.push(field)
      field = ''
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++
      row.push(field)
      rows.push(row)
      row = []
      field = ''
    } else field += c
  }
  if (field !== '' || row.length > 0) {
    row.push(field)
    rows.push(row)
  }
  return rows.filter((r) => r.length > 1 || r[0] !== '')
}

/** Rows as objects keyed by the header row. */
export function parseCsvRecords(text: string): {
  header: Array<string>
  records: Array<Record<string, string>>
} {
  const [header = [], ...rows] = parseCsv(text.replace(/^\uFEFF/, ''))
  return {
    header,
    records: rows.map((r) =>
      Object.fromEntries(header.map((h, i) => [h, r[i] ?? ''])),
    ),
  }
}
