import { createQueryClient } from '@fuda/libs/query'
import type { QueryClient } from '@fuda/libs/query'

// The member pages' query client, one per browser tab. It is module state
// rather than a layout context because @void/solid creates a page before its
// layout, so a layout's providers never reach the page. The cache lives for
// the tab's member visit: signing out is a full navigation, which drops it.
let client: QueryClient | null = null

export const memberQueryClient = (): QueryClient => {
  if (client === null) {
    client = createQueryClient()
    client.mount()
  }
  return client
}
