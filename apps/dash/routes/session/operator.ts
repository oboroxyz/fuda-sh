import { apiOriginFor } from '@fuda/libs/worker'
import { defineHandler } from 'void'

import { verifyOperator } from '../../src/server/session-routes.ts'

export const POST = defineHandler(async (c) => await verifyOperator(c, apiOriginFor(c.env.API_BASE_URL)))
