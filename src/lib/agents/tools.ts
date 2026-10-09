/**
 * What an Agent can do with Budgy (docs/adr/0004): read the Household's
 * spending every way the app shows it, hear Budget Alerts, get a Daily
 * Digest of a day's purchases across every Account and, with a `write`
 * token, import an export and Move or note a purchase. Amounts are US
 * dollars. Everything reads the Ledger fresh for each call.
 */

import { z } from 'zod'
import { tool } from './mcp'
import type { McpTool } from './mcp'
import type { Caller } from './tokens'
import type { Database } from '@/lib/db'
import type { Book } from '@/lib/model/book'
import {
  loadLedger,
  moveTransaction,
  noteTransaction,
} from '@/lib/ledger/queries'
import { runImport } from '@/lib/ledger/importer'
import { buildBook } from '@/lib/model/book'
import { budgetAlerts } from '@/lib/model/alerts'
import { agentTxn, dailyDigest } from '@/lib/model/digest'
import { breakdown, inSelection } from '@/lib/model/breakdown'
import { categoryHistory, monthView, upcoming } from '@/lib/model/month'
import { PAY_SCHEDULES, percentOf, takeHome } from '@/lib/model/income'
import { categoryOf, ownerOf, targetFor } from '@/lib/model/ledger'
import { monthlySetAside } from '@/lib/model/plans'
import { suggestPlans } from '@/lib/model/detect'
import { addDays, monthRange, shiftMonth } from '@/lib/model/dates'
import { CADENCE_LABELS, OWNERS } from '@/lib/model/types'

export const INSTRUCTIONS = `Budgy is a household budget (two people, Blaze and Alex, plus Joint accounts). All amounts are US dollars; spending is positive, refunds negative. Spending is filed in Categories. Everyday Categories have monthly Targets (the Budget); Housing (mortgage, utilities, upkeep) has none. Planned Expenses are big known bills (car insurance twice a year) budgeted on their due dates, so they are kept out of everyday totals and Targets. "Typical" is the average month without planned bills. Data is only as fresh as the latest imported export: check freshness before calling a day quiet. For a daily report: if you have the finance app's latest CSV export, import it with import_transactions_csv (commit true), then call get_daily_digest (yesterday by default), which includes Budget Alerts.`

export const WRITE_INSTRUCTIONS =
  'This token may also change the Ledger: import_transactions_csv adds new purchases (always preview with commit false first unless asked for a scheduled import), and update_transaction moves a purchase to another Category or notes it. Say what you changed.'

const MONTH = z.string().regex(/^\d{4}-\d{2}$/, 'A month as YYYY-MM')
const DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'A date as YYYY-MM-DD')
const OWNER = z.enum(OWNERS as unknown as [string, ...Array<string>])

const usd = (cents: number) => Math.round(cents) / 100

function categoryRow(r: ReturnType<typeof monthView>['everyday'][number]) {
  return {
    category: r.name,
    tag: r.tag,
    target: r.target === null ? null : usd(r.target),
    spent: usd(r.spent),
    overBy:
      r.target !== null && r.spent > r.target ? usd(r.spent - r.target) : 0,
    plannedPaid: usd(r.plannedPaid),
    plannedStillDue: usd(r.plannedLeft),
    purchases: r.txns.length,
  }
}

function alertsOf(book: Book) {
  return budgetAlerts(
    book.ix,
    book.today,
    book.occurrences,
    book.plannedIds,
  ).map((a) => ({
    ...a,
    amount: a.amount === undefined ? undefined : usd(a.amount),
  }))
}

export function budgyTools(
  db: Database,
  caller: Caller,
  today: string,
): Array<McpTool> {
  let cached: Promise<Book> | null = null
  const book = () =>
    (cached ??= loadLedger(db).then((ledger) => buildBook(ledger, today)))
  const thisMonth = today.slice(0, 7)
  const lastFull = shiftMonth(thisMonth, -1)

  const read: Array<McpTool> = [
    tool({
      name: 'get_daily_digest',
      title: 'Daily digest',
      description:
        'Every purchase on one day across all accounts, totals by person, account and category, the month so far against the Budget, each account’s latest import date, and current Budget Alerts. Use it for a daily report; the default day is yesterday.',
      input: z.object({
        date: DATE.optional().describe(
          'The day, YYYY-MM-DD; default yesterday',
        ),
      }),
      call: async ({ date }) => {
        const b = await book()
        const day = date ?? addDays(today, -1)
        return {
          ...dailyDigest(b.ix, day, today, b.occurrences, b.plannedIds),
          alerts: alertsOf(b),
        }
      },
    }),
    tool({
      name: 'get_budget_alerts',
      title: 'Budget alerts',
      description:
        'What needs attention now: categories over Target or on pace to be, the whole Budget on pace over, planned bills due within two weeks or late, large purchases in the last week, and accounts whose imports look out of date. Most urgent first.',
      input: z.object({}),
      call: async () => ({ today, alerts: alertsOf(await book()) }),
    }),
    tool({
      name: 'get_month_summary',
      title: 'Month summary',
      description:
        'One month against the Budget: each everyday category’s spending, Target and overage, planned bills paid and still due, housing, and the biggest stores. Optionally just one person’s spending.',
      input: z.object({
        month: MONTH.optional().describe('YYYY-MM; default this month'),
        owner: OWNER.optional().describe(
          'Only this person’s (or Joint) spending',
        ),
      }),
      call: async ({ month, owner }) => {
        const b = await book()
        const m = month ?? thisMonth
        const v = monthView(b.ix, m, today, owner ?? null, b.occurrences)
        return {
          month: m,
          owner: owner ?? 'everyone',
          shareOfMonthGone: Math.round(v.elapsed * 100) / 100,
          ...(owner
            ? {
                note: 'Targets are for the whole household; only categories this person spent in are listed.',
              }
            : {}),
          totals: {
            everydaySpent: usd(v.totals.spent),
            [owner ? 'householdEverydayTarget' : 'everydayTarget']: usd(
              v.totals.target,
            ),
            wantsSpent: usd(v.totals.flexibleSpent),
            wantsTarget: usd(v.totals.flexibleTarget),
            plannedPaid: usd(v.totals.plannedPaid),
            plannedStillDue: usd(v.totals.plannedLeft),
            housing: usd(
              v.housing.reduce((n, r) => n + r.spent + r.plannedPaid, 0),
            ),
          },
          categories: v.everyday
            .filter((r) => !owner || r.txns.length > 0)
            .map(categoryRow),
          housing: v.housing.map(categoryRow),
          topStores: v.stores.slice(0, 12).map((s) => ({
            store: s.store,
            spent: usd(s.amount),
            purchases: s.txns.length,
          })),
        }
      },
    }),
    tool({
      name: 'get_spending_breakdown',
      title: 'Spending breakdown',
      description:
        'How part of the household’s spending (a person, some accounts, a search) sits inside each everyday category and against its Target, which accounts it comes from, and month by month. Per-month averages when the period spans several months. E.g. how much of Dining comes from Blaze Apple Card.',
      input: z.object({
        months: z
          .union([z.literal(1), z.literal(3), z.literal(6), z.literal(12)])
          .default(3)
          .describe(
            '1 for a single month, else the last 3, 6 or 12 full months',
          ),
        month: MONTH.optional().describe(
          'With months 1: which month; default this month',
        ),
        owner: OWNER.optional(),
        accounts: z
          .array(z.string())
          .max(20)
          .optional()
          .describe('Account names; see list_accounts_and_categories'),
        search: z
          .string()
          .max(80)
          .optional()
          .describe('Store, description or note contains'),
      }),
      call: async ({ months, month, owner, accounts, search }) => {
        const b = await book()
        const period =
          months === 1 ? [month ?? thisMonth] : monthRange(lastFull, months)
        const sel = {
          owner: owner ?? null,
          accounts: accounts ?? [],
          q: search,
        }
        const r = breakdown(b.ix, period, sel, b.plannedIds)
        return {
          period,
          perMonth: period.length > 1,
          selection: {
            owner: owner ?? null,
            accounts: accounts ?? [],
            search: search ?? null,
          },
          totals: {
            everyone: usd(r.totals.total),
            selection: usd(r.totals.selected),
            everydayTargets: usd(r.totals.target),
            purchases: r.totals.count,
          },
          categories: r.categories.map((c) => ({
            category: c.name,
            tag: c.tag,
            everyone: usd(c.total),
            selection: usd(c.selected),
            target: c.target === null ? null : usd(c.target),
            selectionShareOfCategory: c.total
              ? Math.round((c.selected / c.total) * 100)
              : 0,
            selectionShareOfTarget: c.target
              ? Math.round((c.selected / c.target) * 100)
              : null,
          })),
          sources: r.sources.map((s) => ({ ...s, amount: usd(s.amount) })),
          byMonth: r.months.map((m) => ({
            month: m.month,
            everyone: usd(m.total),
            selection: usd(m.selected),
          })),
        }
      },
    }),
    tool({
      name: 'get_transactions',
      title: 'Transactions',
      description:
        'Purchases matching filters, newest first, with their category, owner, account and note. Includes housing and planned bills.',
      input: z.object({
        from: DATE.optional().describe('First day; default 30 days ago'),
        to: DATE.optional().describe('Last day; default today'),
        owner: OWNER.optional(),
        account: z.string().optional(),
        category: z.string().optional(),
        search: z
          .string()
          .max(80)
          .optional()
          .describe('Store, description or note contains'),
        minAmount: z.number().optional().describe('Dollars'),
        limit: z.number().int().min(1).max(500).default(100),
      }),
      call: async ({
        from,
        to,
        owner,
        account,
        category,
        search,
        minAmount,
        limit,
      }) => {
        const b = await book()
        const start = from ?? addDays(today, -30)
        const end = to ?? today
        const sel = {
          owner: owner ?? null,
          accounts: account ? [account] : [],
          q: search,
        }
        const rows = b.ix.ledger.txns
          .filter(
            (t) =>
              t.date >= start &&
              t.date <= end &&
              inSelection(b.ix, t, sel) &&
              (!category || categoryOf(b.ix, t) === category) &&
              (minAmount === undefined || t.amount >= minAmount * 100),
          )
          .sort((x, y) => y.date.localeCompare(x.date) || y.amount - x.amount)
        return {
          from: start,
          to: end,
          count: rows.length,
          total: usd(rows.reduce((n, t) => n + t.amount, 0)),
          transactions: rows
            .slice(0, limit)
            .map((t) => agentTxn(b.ix, t, b.plannedIds)),
          truncated: rows.length > limit,
        }
      },
    }),
    tool({
      name: 'get_category_history',
      title: 'Category history',
      description:
        'One category month by month: everyday spending, planned bills, the Target in force and the difference, the typical month, and its biggest stores.',
      input: z.object({
        category: z.string().min(1),
        months: z
          .number()
          .int()
          .min(1)
          .max(24)
          .default(12)
          .describe('Full months back'),
      }),
      call: async ({ category, months }) => {
        const b = await book()
        const period = monthRange(lastFull, months)
        const h = categoryHistory(b.ix, period, b.plannedIds).get(category)
        if (!h && !b.ix.categories.has(category))
          throw new Error(
            `No category named ${category}; see list_accounts_and_categories`,
          )
        const typical3 =
          categoryHistory(b.ix, monthRange(lastFull, 3), b.plannedIds).get(
            category,
          )?.typical ?? 0
        const stores = new Map<string, number>()
        const inPeriod = new Set(period)
        for (const t of b.ix.ledger.txns)
          if (inPeriod.has(t.month) && categoryOf(b.ix, t) === category)
            stores.set(t.store, (stores.get(t.store) ?? 0) + t.amount)
        return {
          category,
          typicalLast3Months: usd(typical3),
          averageOverPeriod: usd(h?.typical ?? 0),
          targetNow: (() => {
            const t = targetFor(b.ix, category, thisMonth)
            return t === null ? null : usd(t)
          })(),
          months: period.map((m, i) => {
            const target = targetFor(b.ix, category, m)
            const everyday = h?.monthly[i] ?? 0
            return {
              month: m,
              everyday: usd(everyday),
              planned: usd((h?.allMonthly[i] ?? 0) - everyday),
              target: target === null ? null : usd(target),
              vsTarget: target === null ? null : usd(everyday - target),
            }
          }),
          topStores: [...stores]
            .sort((x, y) => y[1] - x[1])
            .slice(0, 10)
            .map(([store, amount]) => ({ store, total: usd(amount) })),
        }
      },
    }),
    tool({
      name: 'get_budget',
      title: 'Budget',
      description:
        'The plan: every category’s monthly Target now, its typical month over the last 3 and 12 full months (without planned bills), its tag (need, nice, fluff) and group, what to set aside for planned bills, and typical take-home pay with how much of it a typical month spends.',
      input: z.object({}),
      call: async () => {
        const b = await book()
        const h3 = categoryHistory(b.ix, monthRange(lastFull, 3), b.plannedIds)
        const h12 = categoryHistory(
          b.ix,
          monthRange(lastFull, 12),
          b.plannedIds,
        )
        const names = new Set([...b.ix.categories.keys(), ...h12.keys()])
        const rows = [...names].map((name) => {
          const target = targetFor(b.ix, name, thisMonth)
          return {
            category: name,
            tag: b.ix.categories.get(name)?.tag ?? 'nice',
            group: b.ix.categories.get(name)?.group ?? 'everyday',
            target: target === null ? null : usd(target),
            typical3: usd(h3.get(name)?.typical ?? 0),
            typical12: usd(h12.get(name)?.typical ?? 0),
          }
        })
        const everyday = rows.filter((r) => r.group === 'everyday')
        const setAside = b.ix.ledger.plans
          .filter((p) => p.active)
          .reduce((n, p) => n + monthlySetAside(p), 0)
        const pay = takeHome(b.ix.ledger.income, monthRange(lastFull, 3), today)
        const spent3 = [...h3.values()].reduce((n, h) => n + h.typical, 0)
        return {
          month: thisMonth,
          everydayTargets: everyday.reduce((n, r) => n + (r.target ?? 0), 0),
          everydayTypical3:
            Math.round(everyday.reduce((n, r) => n + r.typical3, 0) * 100) /
            100,
          plannedSetAsidePerMonth: usd(setAside),
          takeHome: {
            perMonth: usd(pay.monthly),
            basis: pay.basis,
            otherIncomePerMonth: usd(pay.other),
            employers: pay.sources.map((p) => ({
              payer: p.payer,
              perCheck: usd(p.perCheck),
              schedule: PAY_SCHEDULES[p.perYear],
              perMonth: usd(p.monthly),
              stopped: p.ended,
            })),
            typicalSpendingPerMonth: usd(spent3 + setAside),
            percentSpent: percentOf(spent3 + setAside, pay.monthly),
          },
          categories: rows.sort((x, y) => y.typical3 - x.typical3),
        }
      },
    }),
    tool({
      name: 'get_upcoming_bills',
      title: 'Upcoming bills',
      description:
        'Planned bills not yet paid in the coming days, every planned bill with its schedule, and bills spotted in history that look like they should be planned.',
      input: z.object({
        days: z.number().int().min(1).max(365).default(60),
      }),
      call: async ({ days }) => {
        const b = await book()
        return {
          today,
          dueSoon: upcoming(b.occurrences, today, addDays(today, days)).map(
            (o) => ({
              name: o.plan.name,
              category: o.plan.category,
              due: o.due,
              amount: usd(o.plan.amount),
              late: o.due < today,
            }),
          ),
          planned: b.ix.ledger.plans.map((p) => ({
            name: p.name,
            category: p.category,
            store: p.store,
            amount: usd(p.amount),
            cadence: CADENCE_LABELS[p.cadence],
            setAsidePerMonth: usd(monthlySetAside(p)),
            active: p.active,
          })),
          suggested: suggestPlans(b.ix, today).map((s) => ({
            store: s.store,
            category: s.category,
            cadence: CADENCE_LABELS[s.cadence],
            latestAmount: usd(s.amount),
            nextDue: s.nextDue,
          })),
        }
      },
    }),
    tool({
      name: 'list_accounts_and_categories',
      title: 'Accounts and categories',
      description:
        'The accounts (whose they are, how far their imported data reaches) and the categories, by the exact names the other tools take.',
      input: z.object({}),
      call: async () => {
        const b = await book()
        const reach = new Map<
          string,
          { first: string; last: string; count: number }
        >()
        for (const t of b.ix.ledger.txns) {
          const r = reach.get(t.account) ?? {
            first: t.date,
            last: t.date,
            count: 0,
          }
          if (t.date < r.first) r.first = t.date
          if (t.date > r.last) r.last = t.date
          r.count++
          reach.set(t.account, r)
        }
        return {
          owners: OWNERS,
          accounts: b.ix.ledger.accounts.map((a) => ({
            account: a.name,
            owner: a.owner,
            firstPurchase: reach.get(a.name)?.first ?? null,
            latestPurchase: reach.get(a.name)?.last ?? null,
            purchases: reach.get(a.name)?.count ?? 0,
          })),
          categories: [...b.ix.categories.values()].map((c) => ({
            category: c.name,
            tag: c.tag,
            group: c.group,
          })),
        }
      },
    }),
  ]

  const write: Array<McpTool> = [
    tool({
      name: 'import_transactions_csv',
      title: 'Import transactions (CSV)',
      description:
        'Import the finance app’s CSV export (columns Date, Description, Type, Category, Amount, Account, …). Only spending is kept; purchases already imported are never added twice, so overlapping exports are safe. With commit false (the default) it only reports what would be added.',
      input: z.object({
        fileName: z.string().max(200).default('agent-import.csv'),
        csv: z
          .string()
          .min(1)
          .max(5_000_000)
          .describe('The whole CSV file as text'),
        commit: z.boolean().default(false),
      }),
      call: async ({ fileName, csv, commit }) => {
        const summary = await runImport(db, {
          fileName,
          text: csv,
          commit,
          importedBy: `${caller.memberEmail} via ${caller.agentName}`,
        })
        cached = null
        return { committed: commit && summary.added > 0, ...summary }
      },
    }),
    tool({
      name: 'update_transaction',
      title: 'Move or note a purchase',
      description:
        'Move one purchase to another category (null puts it back where its store usually goes) and/or set its note (null clears it). Take the id from get_transactions or get_daily_digest.',
      input: z.object({
        id: z.string().min(1).max(16),
        category: z.string().trim().min(1).max(60).nullable().optional(),
        note: z.string().trim().max(200).nullable().optional(),
      }),
      call: async ({ id, category, note }) => {
        const b = await book()
        const t = b.ix.ledger.txns.find((x) => x.id === id)
        if (!t) throw new Error(`No purchase with id ${id}`)
        if (category !== undefined) await moveTransaction(db, id, category)
        if (note !== undefined) await noteTransaction(db, id, note)
        cached = null
        const after = (await book()).ix
        const updated = after.ledger.txns.find((x) => x.id === id)!
        return {
          ...agentTxn(after, updated, new Set()),
          owner: ownerOf(after, updated),
          before: { category: categoryOf(b.ix, t), note: t.note },
        }
      },
    }),
  ]

  return caller.scopes.includes('write') ? [...read, ...write] : read
}
