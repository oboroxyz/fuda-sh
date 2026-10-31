import { defineHandler } from 'void'

import { signOut } from '../../src/server/session-routes.ts'

export const POST = defineHandler(async (c) => await signOut(c, c.env.API_BASE_URL))
