import { apiOriginFor } from '@fuda/libs/worker'
import { defineHandler } from 'void'

import { forwardMemberApi } from '../../src/server/member-api.ts'

const forward = defineHandler(async (c) => await forwardMemberApi(c, apiOriginFor(c.env.API_BASE_URL)))

export const GET = forward
export const POST = forward
export const PUT = forward
export const PATCH = forward
export const DELETE = forward
