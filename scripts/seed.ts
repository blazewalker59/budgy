/**
 * Load the Household's starting data into D1: every CSV in seed/, plus the
 * labels made in the planning artifact (seed/artifact-state.json: owners,
 * Store moves and Tags, per-purchase Moves and notes, Targets).
 *
 *   bun scripts/seed.ts --local
 *   bun scripts/seed.ts --remote --env production
 *
 * Safe to run again: rows already there are kept, labels are re-applied.
 * With --income-only, only adds Income rows (backfilling a Ledger imported
 * before Income was kept) and touches nothing else.
 * seed/ is git-ignored; household data never goes in the repository.
 */

import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { parseExport } from '../src/lib/import/rows'
import { importRulesSchema } from '../src/lib/import/rules'
import { defaultOwner } from '../src/lib/import/stores'
import { DEFAULT_CATEGORIES, newCategory } from '../src/lib/model/defaults'

const SEED = join(dirname(fileURLToPath(import.meta.url)), '..', 'seed')
const q = (v: string | number | null) =>
  v === null
    ? 'NULL'
    : typeof v === 'number'
      ? String(v)
      : `'${v.replace(/'/g, "''")}'`

interface ArtifactLabels {
  owners?: Record<string, string>
  catTags?: Record<string, string>
  catTargets?: Record<string, number>
  merchCats?: Record<string, string>
  merchTags?: Record<string, string>
  txnCats?: Record<string, string>
  txnNotes?: Record<string, string>
}

const csvs = readdirSync(SEED)
  .filter((f) => f.endsWith('.csv'))
  .sort()
if (!csvs.length) throw new Error(`No CSV files in ${SEED}`)

const incomeOnly = process.argv.includes('--income-only')
const sql: Array<string> = []

// The Household's Import Rules (account names, local vendors) are kept in
// the database, never in the repository.
const rulesPath = join(SEED, 'import-rules.json')
const rules = existsSync(rulesPath)
  ? importRulesSchema.parse(JSON.parse(readFileSync(rulesPath, 'utf8')))
  : undefined
if (rules)
  sql.push(
    `INSERT OR REPLACE INTO settings (key, value) VALUES ('import_rules', ${q(JSON.stringify(rules))});`,
  )
const categoryNames = new Set<string>()
const addCategory = (name: string) => {
  if (categoryNames.has(name)) return
  categoryNames.add(name)
  const c = newCategory(name)
  sql.push(
    `INSERT OR IGNORE INTO categories (name, tag, "group") VALUES (${q(c.name)}, ${q(c.tag)}, ${q(c.group)});`,
  )
}
for (const c of DEFAULT_CATEGORIES) addCategory(c.name)

let firstMonth = '9999-99'
let total = 0
for (const file of csvs) {
  const { txns, income } = await parseExport(
    readFileSync(join(SEED, file), 'utf8'),
    rules,
  )
  const importId = `im_seed_${file.replace(/[^a-z0-9]/gi, '').slice(0, 20)}`
  const accounts = new Map(txns.map((t) => [t.account, t.accountSource]))
  for (const [name, source] of accounts)
    sql.push(
      `INSERT OR IGNORE INTO accounts (name, source_name, owner) VALUES (${q(name)}, ${q(source)}, ${q(defaultOwner(name))});`,
    )
  for (const i of income)
    sql.push(
      `INSERT OR IGNORE INTO income (id, date, month, account, description, payer, source_category, amount, import_id) VALUES (${[i.id, i.date, i.month, i.account, i.description, i.payer, i.sourceCategory, i.amount, importId].map(q).join(', ')});`,
    )
  for (const t of txns) {
    addCategory(t.sourceCategory)
    if (t.month < firstMonth) firstMonth = t.month
    sql.push(
      `INSERT OR IGNORE INTO transactions (id, date, month, account, description, store, source_category, amount, import_id) VALUES (${[t.id, t.date, t.month, t.account, t.description, t.store, t.sourceCategory, t.amount, importId].map(q).join(', ')});`,
    )
  }
  sql.push(
    `INSERT OR IGNORE INTO imports (id, file_name, imported_by, added, skipped) VALUES (${q(importId)}, ${q(file)}, 'seed', ${txns.length}, 0);`,
  )
  total += txns.length
  console.log(`${file}: ${txns.length} purchases, ${income.length} deposits`)
}

const statePath = join(SEED, 'artifact-state.json')
if (existsSync(statePath) && !incomeOnly) {
  const labels: ArtifactLabels =
    JSON.parse(readFileSync(statePath, 'utf8')).labels ?? {}
  const unkey = (k: string) => {
    const [cat, ...rest] = k.split('|')
    return [cat, rest.join('|').replace(/%2E/g, '.')] as const
  }
  for (const [account, owner] of Object.entries(labels.owners ?? {}))
    sql.push(
      `UPDATE accounts SET owner = ${q(owner)} WHERE name = ${q(account)};`,
    )
  for (const [name, tag] of Object.entries(labels.catTags ?? {})) {
    addCategory(name)
    sql.push(`UPDATE categories SET tag = ${q(tag)} WHERE name = ${q(name)};`)
  }
  // Targets apply from the first month of data, so past months compare too.
  for (const [name, dollars] of Object.entries(labels.catTargets ?? {})) {
    addCategory(name)
    sql.push(
      `INSERT OR REPLACE INTO budget_targets (category, starts_month, amount) VALUES (${q(name)}, ${q(firstMonth)}, ${Math.round(dollars * 100)});`,
    )
  }
  const storeRules = new Map<
    string,
    { cat: string; store: string; category: string | null; tag: string | null }
  >()
  const rule = (k: string) => {
    const [cat, store] = unkey(k)
    const r = storeRules.get(k) ?? { cat, store, category: null, tag: null }
    storeRules.set(k, r)
    return r
  }
  for (const [k, category] of Object.entries(labels.merchCats ?? {})) {
    addCategory(category)
    rule(k).category = category
  }
  for (const [k, tag] of Object.entries(labels.merchTags ?? {}))
    rule(k).tag = tag
  for (const r of storeRules.values())
    sql.push(
      `INSERT OR REPLACE INTO store_rules (source_category, store, category, tag) VALUES (${q(r.cat)}, ${q(r.store)}, ${q(r.category)}, ${q(r.tag)});`,
    )
  for (const [id, category] of Object.entries(labels.txnCats ?? {})) {
    addCategory(category)
    sql.push(
      `UPDATE transactions SET category = ${q(category)} WHERE id = ${q(id)};`,
    )
  }
  for (const [id, note] of Object.entries(labels.txnNotes ?? {}))
    sql.push(
      `UPDATE transactions SET note = ${q(note.slice(0, 200))} WHERE id = ${q(id)};`,
    )
  console.log(
    `artifact labels: ${Object.keys(labels.catTargets ?? {}).length} targets, ${storeRules.size} store rules, ${Object.keys(labels.txnCats ?? {}).length} moves, ${Object.keys(labels.txnNotes ?? {}).length} notes`,
  )
}

// Categories first, so every reference lands on an existing one.
const categoriesFirst = incomeOnly
  ? sql.filter((s) => s.startsWith('INSERT OR IGNORE INTO income'))
  : [
      ...sql.filter((s) => s.startsWith('INSERT OR IGNORE INTO categories')),
      ...sql.filter((s) => !s.startsWith('INSERT OR IGNORE INTO categories')),
    ]
const out = join(SEED, 'seed.sql')
writeFileSync(out, categoriesFirst.join('\n') + '\n')
console.log(`${total} purchases → ${out}`)

const args = [
  'wrangler',
  'd1',
  'execute',
  'budgy-db',
  '--file',
  out,
  ...process.argv.slice(2).filter((a) => a !== '--income-only'),
]
console.log(`bunx ${args.join(' ')}`)
const run = spawnSync('bunx', args, { stdio: 'inherit' })
process.exit(run.status ?? 1)
