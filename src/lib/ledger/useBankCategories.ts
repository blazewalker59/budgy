import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { getBankCategories, setBankCategory } from './server'
import { LEDGER_KEY, reportSaveError, useSession } from './useLedger'

export const BANK_CATEGORIES_KEY = ['bank-categories'] as const

/** The bank's own categories, for this Member's Household only. */
export function useBankCategories() {
  const { data: session } = useSession()
  const member = session?.status === 'member' ? session : null
  return useQuery({
    queryKey: [
      ...BANK_CATEGORIES_KEY,
      member?.household.id ?? null,
      member?.member.id ?? null,
    ],
    queryFn: () => getBankCategories(),
    enabled: !!member,
  })
}

/** Say what one means; its purchases move, so the Ledger is read again. */
export function useFileBankCategory() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (v: { name: string; category: string | null }) =>
      setBankCategory({ data: v }),
    onError: reportSaveError,
    onSettled: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: BANK_CATEGORIES_KEY }),
        queryClient.invalidateQueries({ queryKey: LEDGER_KEY }),
      ]),
  })
}
