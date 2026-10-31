import { defineHandler } from 'void'

import { verifyMember } from '../../src/server/session-routes.ts'

export const POST = defineHandler(async (c) => await verifyMember(c, c.env.API_BASE_URL))
