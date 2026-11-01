import { apiOriginFor } from '@fuda/libs/worker'
import { defineHandler } from 'void'

import { verifyMember } from '../../src/server/session-routes.ts'

export const POST = defineHandler(async (c) => await verifyMember(c, apiOriginFor(c.env.API_BASE_URL)))
