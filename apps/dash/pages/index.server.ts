import { defineHandler } from 'void'
import type { InferProps } from 'void'

import { loadMembers } from '../src/server/loaders.ts'

export type Props = InferProps<typeof loader>

// The admin console's overview; operators are redirected to their own home.
export const loader = defineHandler(async (c) => await loadMembers(c, c.env.API_BASE_URL, c.get('token')))
