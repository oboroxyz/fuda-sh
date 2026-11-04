import { apiOriginFor } from '@fuda/libs/worker'
import { defineHandler } from 'void'

import { passkeySession } from '../../src/server/session-routes.ts'

export const POST = defineHandler(async (c) => await passkeySession(c, apiOriginFor(c.env.API_BASE_URL)))
