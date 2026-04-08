import type { PropsWithChildren } from 'react'
import { Provider as JotaiProvider } from 'jotai'
import { QueryClientProvider } from '@tanstack/react-query'
import { queryClient } from '@/core/api/query-client'

export function AppProviders({ children }: PropsWithChildren) {
  return (
    <JotaiProvider>
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </JotaiProvider>
  )
}
