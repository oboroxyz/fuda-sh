import { defineHandler } from 'void'

import { verifyOperator } from '../../src/server/session-routes.ts'

export const POST = defineHandler(async (c) => await verifyOperator(c, c.env.API_BASE_URL))
