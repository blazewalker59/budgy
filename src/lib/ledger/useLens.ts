/**
 * The Lens of whatever screen is open, and ways to change it. A change stays
 * on the screen when that screen honors the filter, and otherwise opens
 * Spending, where every filter applies.
 */

import { useNavigate, useRouterState } from '@tanstack/react-router'
import { useCallback, useMemo } from 'react'
import type { Lens, LensFilter } from '@/lib/model/lens'
import { NO_LENS, isEmpty, readLens, withFilter } from '@/lib/model/lens'

export type LensPage = '/' | '/spending' | '/plan' | '/accounts'

/** What each screen honors of the Lens (Overview: all but the dates). */
export const HONORS: Record<LensPage, Array<keyof Lens> | 'all'> = {
  '/': 'all',
  '/spending': 'all',
  '/plan': ['people'],
  '/accounts': ['people', 'kinds'],
}

const KEY_OF: Record<LensFilter['type'], Array<keyof Lens>> = {
  person: ['people'],
  account: ['accounts'],
  kind: ['kinds'],
  store: ['stores'],
  category: ['categories'],
  tag: ['tags'],
  flag: ['flags'],
  amount: ['min', 'max'],
  when: ['from', 'to'],
  text: ['q'],
}

export function honors(page: LensPage, f: LensFilter): boolean {
  const h = HONORS[page]
  if (h === 'all') return page !== '/' || f.type !== 'when'
  return KEY_OF[f.type].some((k) => h.includes(k))
}

function lensPage(pathname: string): LensPage | null {
  return pathname === '/' ||
    pathname === '/spending' ||
    pathname === '/plan' ||
    pathname === '/accounts'
    ? pathname
    : null
}

export function useLens() {
  const location = useRouterState({ select: (s) => s.location })
  const navigate = useNavigate()
  const page = lensPage(location.pathname)
  const search = location.search as Record<string, unknown>
  const lens = useMemo(() => readLens(search), [search])

  /** Show `next`: here, or on `to` (keeping only the Lens). */
  const show = useCallback(
    (next: Lens, to?: LensPage) => {
      const target = to ?? page ?? '/spending'
      const keep = target === page ? search : {}
      void navigate({
        to: target,
        search: { ...keep, ...NO_LENS, ...next } as never,
      })
    },
    [navigate, page, search],
  )

  /** Add a filter, going to Spending when this screen ignores it. */
  const add = useCallback(
    (f: LensFilter) => {
      const next = withFilter(lens, f)
      show(next, page && honors(page, f) ? page : '/spending')
    },
    [lens, page, show],
  )

  return { lens, page, show, add, empty: isEmpty(lens) }
}

/** Open the ⌘K palette from anywhere (the + Filter button). */
export function openPalette(query = ''): void {
  window.dispatchEvent(new CustomEvent('budgy:palette', { detail: query }))
}
