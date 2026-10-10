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
  deleteLens,
  deletePay,
  deletePlan,
  getLedger,
  getSession,
  keepDuplicatePair,
  mergeDuplicatePair,
  moveTxn,
  noteTxn,
  recordBalances,
  removeStartingPurchases,
  saveAccount,
  saveCategory,
  saveLens,
  savePay,
  savePlan,
  setStoreRule,
  setTarget,
  setWorthBaseline,
} from './server'
import type { AccountEdit } from './server'
import type {
  Balance,
  Category,
  Ledger,
  PaySchedule,
  Plan,
  SavedLens,
  StoreRule,
  Tag,
} from '@/lib/model/types'
import { newCategory } from '@/lib/model/defaults'
import { ANY_SOURCE, TRANSFER } from '@/lib/model/ledger'
import { filedFirst, pairKey } from '@/lib/model/duplicates'

export const SESSION_KEY = ['session'] as const
export const LEDGER_KEY = ['ledger'] as const

/** Never reuse another login's or Household's cached Ledger. */
function useLedgerKey() {
  const { data: session } = useSession()
  return [
    ...LEDGER_KEY,
    session?.status === 'member' ? session.member.id : null,
    session?.status === 'member' ? session.household.id : null,
  ] as const
}

export function useSession() {
  return useQuery({
    queryKey: SESSION_KEY,
    queryFn: () => getSession(),
    staleTime: 15_000,
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
  })
}

export function useLedgerQuery(enabled: boolean) {
  const queryKey = useLedgerKey()
  return useQuery({
    queryKey,
    queryFn: () => getLedger(),
    enabled,
    staleTime: 15_000,
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
  })
}

/** Name a Category in an edit and it exists from then on. */
function withCategory(l: Ledger, name: string | null | undefined): Ledger {
  if (!name || name === TRANSFER || l.categories.some((c) => c.name === name))
    return l
  return { ...l, categories: [...l.categories, newCategory(name)] }
}

function useEdit<TVars>(
  send: (vars: TVars) => Promise<unknown>,
  patch: (ledger: Ledger, vars: TVars) => Ledger,
) {
  const queryClient = useQueryClient()
  const queryKey = useLedgerKey()
  return useMutation({
    mutationFn: send,
    onMutate: async (vars: TVars) => {
      await queryClient.cancelQueries({ queryKey })
      const previous = queryClient.getQueryData<Ledger>(queryKey)
      if (previous)
        queryClient.setQueryData<Ledger>(queryKey, patch(previous, vars))
      return { previous, queryKey }
    },
    onError: (_error, _vars, context) => {
      if (context?.previous)
        queryClient.setQueryData(context.queryKey, context.previous)
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
      // A store-wide rule clears Moves of the Store to the same place.
      const redundant = (t: Ledger['txns'][number]) =>
        v.sourceCategory === ANY_SOURCE &&
        next.category !== null &&
        t.category === next.category &&
        t.store.toLowerCase() === v.store.toLowerCase()
      return withCategory(
        {
          ...l,
          rules: next.category || next.tag ? [...rest, next] : rest,
          txns: l.txns.some(redundant)
            ? l.txns.map((t) => (redundant(t) ? { ...t, category: null } : t))
            : l.txns,
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

/** Take out the starting purchases still here (one Account's, or all). */
export function useRemoveStarting() {
  return useEdit(
    (v: { account?: string }) => removeStartingPurchases({ data: v }),
    (l, v) => ({
      ...l,
      txns: l.txns.filter(
        (t) =>
          !t.starting || (v.account !== undefined && t.account !== v.account),
      ),
    }),
  )
}

/** The two become one (src/lib/ledger/duplicates.ts, `mergeDuplicate`). */
export function useMergeDuplicate() {
  return useEdit(
    (v: { goes: string; stays: string }) => mergeDuplicatePair({ data: v }),
    (l, v) => {
      const goes = l.txns.find((t) => t.id === v.goes)
      if (!goes) return l
      return {
        ...l,
        txns: l.txns
          .filter((t) => t.id !== v.goes)
          .map((t) => {
            if (t.id !== v.stays) return t
            const [filed, other] = filedFirst(t, goes) ? [t, goes] : [goes, t]
            return {
              ...t,
              store: filed.store,
              sourceCategory: filed.sourceCategory,
              category: filed.category ?? other.category ?? null,
              note: filed.note ?? other.note ?? null,
              ...(t.synced || goes.synced ? { synced: true } : {}),
            }
          }),
      }
    },
  )
}

export function useKeepDuplicate() {
  return useEdit(
    (v: { goes: string; stays: string }) => keepDuplicatePair({ data: v }),
    (l, v) => ({ ...l, kept: [...l.kept, pairKey(v.goes, v.stays)] }),
  )
}

export function useWorthBaseline() {
  return useEdit(
    (v: { date: string | null }) => setWorthBaseline({ data: v }),
    (l, v) => ({ ...l, baseline: v.date }),
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

export function useSaveLens() {
  return useEdit(
    (v: SavedLens) => saveLens({ data: v }),
    (l, v) => ({
      ...l,
      lenses: [...l.lenses.filter((x) => x.id !== v.id), v].sort((a, b) =>
        a.name.localeCompare(b.name),
      ),
    }),
  )
}

export function useDeleteLens() {
  return useEdit(
    (v: { id: string }) => deleteLens({ data: v }),
    (l, v) => ({ ...l, lenses: l.lenses.filter((x) => x.id !== v.id) }),
  )
}

export function newLensId(): string {
  return `ln_${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`
}
