import { useQuery } from '@tanstack/react-query'
import { getAccountUpdates } from './server'
import { useSession } from '@/lib/ledger/useLedger'

export const UPDATES_KEY = ['account-updates'] as const
export function useAccountUpdates() {
  const { data: session } = useSession()
  return useQuery({
    queryKey: [
      ...UPDATES_KEY,
      session?.status === 'member' ? session.household.id : null,
      session?.status === 'member' ? session.member.id : null,
    ],
    queryFn: () => getAccountUpdates(),
    enabled: session?.status === 'member',
    staleTime: 15_000,
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
  })
}
