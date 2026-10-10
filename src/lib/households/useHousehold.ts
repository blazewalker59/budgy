import { useQuery } from '@tanstack/react-query'
import { getHousehold } from './server'
import { useSession } from '@/lib/ledger/useLedger'

export const HOUSEHOLD_KEY = ['household'] as const
export const HOUSEHOLD_INVITE_KEY = ['household-invite'] as const

export function useHousehold() {
  const { data: session } = useSession()
  return useQuery({
    queryKey: [
      ...HOUSEHOLD_KEY,
      session?.status === 'member' ? session.household.id : null,
      session?.status === 'member' ? session.member.id : null,
    ],
    queryFn: () => getHousehold(),
    enabled: session?.status === 'member',
    refetchOnWindowFocus: true,
    refetchInterval: 60_000,
  })
}
