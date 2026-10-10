/**
 * What an Agent can do with Budgy (docs/adr/0004): read the Household's
 * spending every way the app shows it, hear Budget Alerts, get a Daily
 * Digest of a day's purchases across every Account and, with a `write`
 * token, add an account's purchases, record balances, and Move or note a
 * purchase. Amounts are US
 * dollars. Everything reads the Ledger fresh for each call.
 */

import { z } from 'zod'
import { tool } from './mcp'
import type { McpTool } from './mcp'
import type { Caller } from './tokens'
import type { HouseholdDatabase as Database } from '@/lib/households/scope'
import type { Book } from '@/lib/model/book'
import {
  loadLedger,
  moveTransaction,
  noteTransaction,
} from '@/lib/ledger/queries'
import {
  findAccount,
  postTransactions,
  recordBalances,
} from '@/lib/ledger/accounts'
import { postedRowInput } from '@/lib/import/posted'
import {
  equity,
  isDebt,
  latestBalances,
  netWorth,
  netWorthByMonth,
} from '@/lib/model/accounts'
import { buildBook } from '@/lib/model/book'
import { budgetAlerts } from '@/lib/model/alerts'
import { agentTxn, dailyDigest } from '@/lib/model/digest'
import { breakdown, inSelection } from '@/lib/model/breakdown'
import { categoryHistory, monthView, upcoming } from '@/lib/model/month'
import { percentOf, takeHome } from '@/lib/model/pay'
import { categoryOf, everyTxn, ownerOf, targetFor } from '@/lib/model/ledger'
import { monthlySetAside } from '@/lib/model/plans'
import { suggestPlans } from '@/lib/model/detect'
import { addDays, monthRange, shiftMonth } from '@/lib/model/dates'
import { CADENCE_LABELS, PAY_CADENCE_LABELS } from '@/lib/model/types'

export const INSTRUCTIONS = `Budgy is a household budget. Your token accesses only its own Household. Discover account owners from the Ledger rather than assuming their names. All amounts are US dollars; spending is positive, refunds negative. Spending is filed in Categories. Everyday Categories have monthly Targets (the Budget); Housing (mortgage, utilities, upkeep) has none. Planned Expenses are known bills. Those less often than monthly (car insurance twice a year) are set aside: budgeted on their due dates and kept out of everyday totals and Targets. Monthly ones (subscriptions) count toward their Category's Target like any purchase. "Typical" is the average month without set-aside bills. Purchases arrive per account (a Member's upload of that account's export, or an Agent's add_transactions), so data is only as fresh as each account's latest: check freshness before calling a day quiet. Accounts also have balances over time (cards, bank, investment, retirement, 529s), recorded by hand or by an Agent; get_net_worth reads them. For a daily report: if you have an account's new purchases (say, the day's Apple Card activity), add them with add_transactions (commit true), then call get_daily_digest (yesterday by default), which includes Budget Alerts.`

export const WRITE_INSTRUCTIONS =
  'This token may also change the Ledger: add_transactions adds purchases you read yourself to one account (for a daily Apple Card upload: the day’s purchases, commit true); record_balances records account balances, one or a whole history; update_transaction moves a purchase to another Category or notes it. Preview purchases with commit false first unless asked for a scheduled one. Say what you changed.'

const MONTH = z.string().regex(/^\d{4}-\d{2}$/, 'A month as YYYY-MM')
const DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'A date as YYYY-MM-DD')
const OWNER = z.string().trim().min(1).max(60)

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
  return budgetAlerts(book.ix, book.today, book.occurrences).map((a) => ({
    ...a,
    amount: a.amount === undefined ? undefined : usd(a.amount),
  }))
}

export function budgyTools(
  db: Database,
  caller: Caller,
  today: string,
): Array<McpTool> {
  if (db.householdId !== caller.householdId)
    throw new Error('Household scope mismatch')
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
        'The plan: every category’s monthly Target now, its typical month over the last 3 and 12 full months (without set-aside bills), its tag (need, nice, fluff) and group, what to set aside for planned bills, and take-home pay (as the Household entered it) with how much of it a typical month spends.',
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
        const pay = takeHome(b.ix.ledger.pay, today)
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
            paychecks: pay.schedules.map((r) => ({
              name: r.schedule.name,
              perCheck: usd(r.schedule.amount),
              schedule: PAY_CADENCE_LABELS[r.schedule.cadence],
              perMonth: usd(r.monthly),
              nextPayday: r.next,
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
        'The accounts (whose they are, their kind and institution, latest balance, how far their purchases reach) and the categories, by the exact names the other tools take.',
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
          owners: [...new Set(b.ix.ledger.accounts.map((a) => a.owner))].sort(),
          accounts: b.ix.ledger.accounts.map((a) => ({
            account: a.name,
            owner: a.owner,
            kind: a.kind,
            institution: a.institution,
            closed: a.closed,
            ...(a.securedBy ? { securedBy: a.securedBy } : {}),
            balance: (() => {
              const bal = latestBalances(b.ix.ledger.balances).get(a.name)
              return bal ? { amount: usd(bal.amount), asOf: bal.date } : null
            })(),
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
    tool({
      name: 'get_net_worth',
      title: 'Net worth',
      description:
        'What the Household has and owes: every open account’s latest balance by kind and owner (cards and loans count against; a home counts at its estimated value), home equity (value minus the loans against it), net worth now, and net worth at each month’s end. Balances are recorded by hand or by an Agent, so check each one’s asOf date.',
      input: z.object({
        months: z.number().int().min(1).max(120).default(12),
      }),
      call: async ({ months }) => {
        const b = await book()
        const l = b.ix.ledger
        const latest = latestBalances(l.balances)
        const now = netWorth(l)
        return {
          today,
          have: usd(now.assets),
          owe: usd(now.debts),
          netWorth: usd(now.net),
          accounts: l.accounts
            .filter((a) => !a.closed)
            .map((a) => {
              const bal = latest.get(a.name)
              return {
                account: a.name,
                kind: a.kind,
                owner: a.owner,
                institution: a.institution,
                balance: bal ? usd(bal.amount) : null,
                countsAs: isDebt(a) ? 'owed' : 'held',
                asOf: bal?.date ?? null,
              }
            }),
          homeEquity: equity(l).map((e) => ({
            property: e.property,
            estimatedValue: usd(e.value),
            owed: usd(e.owed),
            loans: e.loans,
            equity: usd(e.equity),
          })),
          byMonth: netWorthByMonth(l, monthRange(thisMonth, months)).map(
            (m) => ({
              month: m.month,
              have: usd(m.assets),
              owe: usd(m.debts),
              netWorth: usd(m.net),
            }),
          ),
        }
      },
    }),
  ]

  const write: Array<McpTool> = [
    tool({
      name: 'record_balances',
      title: 'Record balances',
      description:
        'Record what accounts held (or, for cards and loans, owed) on a day: today’s balances, or a whole history when an account is first set up. A balance for the same account and day replaces the earlier one. Account names as list_accounts_and_categories gives them (any case).',
      input: z.object({
        balances: z
          .array(
            z.object({
              account: z.string().min(1).max(60),
              balance: z
                .number()
                .describe(
                  'Dollars as the account shows it; a card’s balance owed is positive',
                ),
              date: DATE.optional().describe('YYYY-MM-DD; default today'),
            }),
          )
          .min(1)
          .max(5000),
      }),
      call: async ({ balances }) => {
        const names = new Map<string, string>()
        for (const n of new Set(balances.map((x) => x.account)))
          names.set(n, (await findAccount(db, n)).name)
        const rows = balances.map((x) => ({
          account: names.get(x.account)!,
          date: x.date ?? today,
          amount: Math.round(x.balance * 100),
        }))
        await recordBalances(
          db,
          rows,
          `${caller.memberEmail} via ${caller.agentName}`,
        )
        cached = null
        const now = netWorth((await book()).ix.ledger)
        return {
          recorded: rows.length,
          accounts: [...new Set(rows.map((r) => r.account))],
          netWorthNow: usd(now.net),
        }
      },
    }),
    tool({
      name: 'add_transactions',
      title: 'Add purchases to an account',
      description:
        'Add purchases you read yourself (say, a day of Apple Card activity) to one account. Each is filed under the category given if it names one of the household’s categories, else where that store’s purchases usually go, else Uncategorized. Purchases already there are skipped, including one on the same day for the same amount under another description, so posting the same day twice is safe. Leave out card payments and transfers. With commit false (the default) it only reports what would be added.',
      input: z.object({
        account: z.string().min(1).max(60),
        transactions: z
          .array(postedRowInput.omit({ sourceId: true }))
          .min(1)
          .max(2000),
        commit: z.boolean().default(false),
      }),
      call: async ({ account, transactions, commit }) => {
        const summary = await postTransactions(db, {
          account,
          rows: transactions,
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
        'Move one purchase to another category ("Transfer" leaves it out of spending as money moving between the household’s own accounts; null puts it back where its store usually goes) and/or set its note (null clears it). Take the id from get_transactions or get_daily_digest.',
      input: z.object({
        id: z.string().min(1).max(16),
        category: z.string().trim().min(1).max(60).nullable().optional(),
        note: z.string().trim().max(200).nullable().optional(),
      }),
      call: async ({ id, category, note }) => {
        const b = await book()
        const t = everyTxn(b.ix).find((x) => x.id === id)
        if (!t) throw new Error(`No purchase with id ${id}`)
        if (category !== undefined) await moveTransaction(db, id, category)
        if (note !== undefined) await noteTransaction(db, id, note)
        cached = null
        const after = (await book()).ix
        const updated = everyTxn(after).find((x) => x.id === id)!
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
