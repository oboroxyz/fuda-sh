import { defineHandler } from 'void'

import { startAdmin } from '../../src/server/session-routes.ts'

export const POST = defineHandler(async (c) => await startAdmin(c))
