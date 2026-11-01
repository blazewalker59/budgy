/**
 * Money in in the browser (docs/adr/0011). Filing patches the list before
 * the server answers; an offset also changes the Ledger (its refund), so
 * the Ledger is refetched once the server has it.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { fileMoney, getMoneyIn } from './server'
import type { MoneyInFiling } from './service'
import type { MoneyIn } from '@/lib/model/moneyIn'
import {
  LEDGER_KEY,
  clearSaveError,
  reportSaveError,
  useSession,
} from '@/lib/ledger/useLedger'

export const MONEY_IN_KEY = ['money-in'] as const

/** Scoped to the signed-in Member and Household, so a switch never shows stale rows. */
function useMoneyInKey() {
  const { data: session } = useSession()
  const member = session?.status === 'member' ? session : null
  return {
    queryKey: [
      ...MONEY_IN_KEY,
      member?.household.id ?? null,
      member?.member.id ?? null,
    ] as const,
    enabled: !!member,
  }
}

export function useMoneyIn() {
  const { queryKey, enabled } = useMoneyInKey()
  return useQuery({
    queryKey,
    queryFn: () => getMoneyIn(),
    enabled,
    staleTime: 15_000,
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
  })
}

export function useFileMoneyIn() {
  const queryClient = useQueryClient()
  const { queryKey } = useMoneyInKey()
  return useMutation({
    mutationFn: (filing: MoneyInFiling) => fileMoney({ data: filing }),
    onMutate: async (filing) => {
      await queryClient.cancelQueries({ queryKey })
      const previous = queryClient.getQueryData<Array<MoneyIn>>(queryKey)
      if (previous)
        queryClient.setQueryData<Array<MoneyIn>>(
          queryKey,
          previous.map((m) =>
            m.id === filing.id
              ? {
                  ...m,
                  use: filing.use,
                  category:
                    filing.use === 'offset' ? (filing.category ?? null) : null,
                  offset:
                    filing.use === 'offset'
                      ? (filing.offset ?? m.amount)
                      : null,
                  note:
                    filing.note === undefined ? m.note : filing.note || null,
                }
              : m,
          ),
        )
      return { previous }
    },
    onError: (error, _filing, context) => {
      if (context?.previous)
        queryClient.setQueryData(queryKey, context.previous)
      reportSaveError(error)
    },
    onSuccess: () => clearSaveError(),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: MONEY_IN_KEY })
      void queryClient.invalidateQueries({ queryKey: LEDGER_KEY })
    },
  })
}
