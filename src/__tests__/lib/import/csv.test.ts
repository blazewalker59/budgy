import { describe, expect, it } from 'vitest'
import { parseCsv, parseCsvRecords } from '@/lib/import/csv'

describe('parseCsv', () => {
  it('reads quoted fields, doubled quotes and CRLF', () => {
    expect(parseCsv('a,"b, c","say ""hi"""\r\n1,2,3\n')).toEqual([
      ['a', 'b, c', 'say "hi"'],
      ['1', '2', '3'],
    ])
  })

  it('keeps newlines inside quotes and drops blank lines', () => {
    expect(parseCsv('x,"two\nlines"\n\n')).toEqual([['x', 'two\nlines']])
  })

  it('keys records by header and strips a BOM', () => {
    const { header, records } = parseCsvRecords('﻿Date,Amount\n2026-01-01,-5')
    expect(header).toEqual(['Date', 'Amount'])
    expect(records).toEqual([{ Date: '2026-01-01', Amount: '-5' }])
  })
})
