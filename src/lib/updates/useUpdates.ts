import { useQuery } from '@tanstack/react-query'
import {
  getAccountUpdates,
  getBankConnections,
  getUploadTokens,
} from './server'
import { useSession } from '@/lib/ledger/useLedger'

export const UPDATES_KEY = ['account-updates'] as const
export const UPLOAD_TOKENS_KEY = ['upload-tokens'] as const
export const BANK_CONNECTIONS_KEY = ['bank-connections'] as const

/** Scoped to the signed-in Member and Household, so a switch never shows stale rows. */
function useScope() {
  const { data: session } = useSession()
  const member = session?.status === 'member' ? session : null
  return {
    key: [member?.household.id ?? null, member?.member.id ?? null],
    enabled: !!member,
  }
}

export function useAccountUpdates() {
  const scope = useScope()
  return useQuery({
    queryKey: [...UPDATES_KEY, ...scope.key],
    queryFn: () => getAccountUpdates(),
    enabled: scope.enabled,
    staleTime: 15_000,
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
  })
}

export function useUploadTokens() {
  const scope = useScope()
  return useQuery({
    queryKey: [...UPLOAD_TOKENS_KEY, ...scope.key],
    queryFn: () => getUploadTokens(),
    enabled: scope.enabled,
  })
}

export function useBankConnections() {
  const scope = useScope()
  return useQuery({
    queryKey: [...BANK_CONNECTIONS_KEY, ...scope.key],
    queryFn: () => getBankConnections(),
    enabled: scope.enabled,
  })
}
