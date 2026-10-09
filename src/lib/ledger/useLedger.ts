/**
 * The Ledger in the browser: one query holds every row, and each edit
 * patches it before the server answers (the server is the record; a failed
 * edit puts the old Ledger back). The other Member's edits arrive on focus
 * and every minute.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  deleteAccount,
  deleteBalance,
  deletePay,
  deletePlan,
  getLedger,
  getSession,
  moveTxn,
  noteTxn,
  recordBalances,
  saveAccount,
  saveCategory,
  savePay,
  savePlan,
  setStoreRule,
  setTarget,
} from './server'
import type { AccountEdit } from './server'
import type {
  Balance,
  Category,
  Ledger,
  PaySchedule,
  Plan,
  StoreRule,
  Tag,
} from '@/lib/model/types'
import { newCategory } from '@/lib/model/defaults'

export const SESSION_KEY = ['session'] as const
export const LEDGER_KEY = ['ledger'] as const

export function useSession() {
  return useQuery({
    queryKey: SESSION_KEY,
    queryFn: () => getSession(),
    staleTime: 5 * 60_000,
  })
}

export function useLedgerQuery(enabled: boolean) {
  return useQuery({
    queryKey: LEDGER_KEY,
    queryFn: () => getLedger(),
    enabled,
    staleTime: 15_000,
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
  })
}

/** Name a Category in an edit and it exists from then on. */
function withCategory(l: Ledger, name: string | null | undefined): Ledger {
  if (!name || l.categories.some((c) => c.name === name)) return l
  return { ...l, categories: [...l.categories, newCategory(name)] }
}

function useEdit<TVars>(
  send: (vars: TVars) => Promise<unknown>,
  patch: (ledger: Ledger, vars: TVars) => Ledger,
) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: send,
    onMutate: async (vars: TVars) => {
      await queryClient.cancelQueries({ queryKey: LEDGER_KEY })
      const previous = queryClient.getQueryData<Ledger>(LEDGER_KEY)
      if (previous)
        queryClient.setQueryData<Ledger>(LEDGER_KEY, patch(previous, vars))
      return { previous }
    },
    onError: (_error, _vars, context) => {
      if (context?.previous)
        queryClient.setQueryData(LEDGER_KEY, context.previous)
    },
  })
}

export function useMoveTxn() {
  return useEdit(
    (v: { id: string; category: string | null }) => moveTxn({ data: v }),
    (l, v) =>
      withCategory(
        {
          ...l,
          txns: l.txns.map((t) =>
            t.id === v.id ? { ...t, category: v.category } : t,
          ),
        },
        v.category,
      ),
  )
}

export function useNoteTxn() {
  return useEdit(
    (v: { id: string; note: string | null }) => noteTxn({ data: v }),
    (l, v) => ({
      ...l,
      txns: l.txns.map((t) =>
        t.id === v.id ? { ...t, note: v.note?.trim() || null } : t,
      ),
    }),
  )
}

type RulePatch = {
  sourceCategory: string
  store: string
  category?: string | null
  tag?: Tag | null
}

export function useSetStoreRule() {
  return useEdit(
    (v: RulePatch) => setStoreRule({ data: v }),
    (l, v) => {
      const same = (r: StoreRule) =>
        r.sourceCategory === v.sourceCategory && r.store === v.store
      const current = l.rules.find(same)
      const next: StoreRule = {
        sourceCategory: v.sourceCategory,
        store: v.store,
        category:
          v.category === undefined ? (current?.category ?? null) : v.category,
        tag: v.tag === undefined ? (current?.tag ?? null) : v.tag,
      }
      if (next.category === v.sourceCategory) next.category = null
      const rest = l.rules.filter((r) => !same(r))
      return withCategory(
        {
          ...l,
          rules: next.category || next.tag ? [...rest, next] : rest,
        },
        next.category,
      )
    },
  )
}

export function useSetTarget() {
  return useEdit(
    (v: { category: string; startsMonth: string; amount: number | null }) =>
      setTarget({ data: v }),
    (l, v) => {
      const rest = l.targets.filter(
        (t) => !(t.category === v.category && t.startsMonth === v.startsMonth),
      )
      return v.amount === null
        ? { ...l, targets: rest }
        : withCategory(
            {
              ...l,
              targets: [
                ...rest,
                {
                  category: v.category,
                  startsMonth: v.startsMonth,
                  amount: v.amount,
                },
              ],
            },
            v.category,
          )
    },
  )
}

export function useSaveCategory() {
  return useEdit(
    (v: Category) => saveCategory({ data: v }),
    (l, v) => ({
      ...l,
      categories: [...l.categories.filter((c) => c.name !== v.name), v],
    }),
  )
}

export function useSaveAccount() {
  return useEdit(
    (v: AccountEdit) => saveAccount({ data: v }),
    (l, { isNew: _new, ...v }) => ({
      ...l,
      accounts: l.accounts.some((a) => a.name === v.name)
        ? l.accounts.map((a) => (a.name === v.name ? { ...a, ...v } : a))
        : [...l.accounts, { ...v, sourceName: v.name }],
    }),
  )
}

export function useDeleteAccount() {
  return useEdit(
    (v: { name: string }) => deleteAccount({ data: v }),
    (l, v) => ({
      ...l,
      accounts: l.accounts.filter((a) => a.name !== v.name),
      balances: l.balances.filter((b) => b.account !== v.name),
    }),
  )
}

/**
 * Record Balances (one, or a whole history); same day replaces. With
 * `replace` (an Account), its earlier Balances go first.
 */
export function useRecordBalances() {
  return useEdit(
    (v: { balances: Array<Balance>; replace?: string }) =>
      recordBalances({ data: v }),
    (l, v) => {
      const key = (b: Balance) => `${b.account}|${b.date}`
      const fresh = new Set(v.balances.map(key))
      return {
        ...l,
        balances: [
          ...l.balances.filter(
            (b) => b.account !== v.replace && !fresh.has(key(b)),
          ),
          ...v.balances,
        ].sort((a, b) => (a.date < b.date ? -1 : 1)),
      }
    },
  )
}

export function useDeleteBalance() {
  return useEdit(
    (v: { account: string; date: string }) => deleteBalance({ data: v }),
    (l, v) => ({
      ...l,
      balances: l.balances.filter(
        (b) => b.account !== v.account || b.date !== v.date,
      ),
    }),
  )
}

export function useSavePlan() {
  return useEdit(
    (v: Plan) => savePlan({ data: v }),
    (l, v) =>
      withCategory(
        {
          ...l,
          plans: l.plans.some((p) => p.id === v.id)
            ? l.plans.map((p) => (p.id === v.id ? v : p))
            : [...l.plans, v],
        },
        v.category,
      ),
  )
}

export function useDeletePlan() {
  return useEdit(
    (v: { id: string }) => deletePlan({ data: v }),
    (l, v) => ({ ...l, plans: l.plans.filter((p) => p.id !== v.id) }),
  )
}

export function newPlanId(): string {
  return `pe_${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`
}

export function useSavePay() {
  return useEdit(
    (v: PaySchedule) => savePay({ data: v }),
    (l, v) => ({
      ...l,
      pay: l.pay.some((p) => p.id === v.id)
        ? l.pay.map((p) => (p.id === v.id ? v : p))
        : [...l.pay, v],
    }),
  )
}

export function useDeletePay() {
  return useEdit(
    (v: { id: string }) => deletePay({ data: v }),
    (l, v) => ({ ...l, pay: l.pay.filter((p) => p.id !== v.id) }),
  )
}

export function newPayId(): string {
  return `ps_${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`
}
