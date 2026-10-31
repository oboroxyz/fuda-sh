import { defineHandler } from 'void'
import type { InferProps } from 'void'

import { loadMembers } from '../src/server/loaders.ts'

export type Props = InferProps<typeof loader>

export const loader = defineHandler(async (c) => await loadMembers(c, c.env.API_BASE_URL, c.get('token')))
