import { createQueryClient } from '@fuda/libs/query'
import type { QueryClient } from '@fuda/libs/query'

// Public pass data survives member-route navigation. A full sign-out navigation
// drops the document and this cache; server renders never share a client.
let client: QueryClient | null = null

export const memberQueryClient = (): QueryClient => {
  if (import.meta.env.SSR) {
    return createQueryClient()
  }
  if (client === null) {
    client = createQueryClient()
    client.mount()
  }
  return client
}
