import type { Context } from 'hono'

import { resolveMemberSession, resolveOperatorSession } from '../auth/session.ts'
import type { MemberSession, OperatorSession, SessionResolution } from '../auth/session.ts'
import type { AppEnv } from '../env.ts'

const bearerToken = (c: Context<AppEnv>): string => {
  const header = c.req.header('Authorization') ?? ''
  return header.startsWith('Bearer ') ? header.slice('Bearer '.length) : ''
}

// The session behind the request's bearer token. A missing token reads the same
// as an unknown one, so each caller decides only what those mean on its route.
export const operatorBearerSession = async (
  c: Context<AppEnv>,
): Promise<SessionResolution<OperatorSession>> => {
  const token = bearerToken(c)
  return token === '' ? { kind: 'invalid' } : await resolveOperatorSession(c.get('db'), token, c.get('now')())
}

export const memberBearerSession = async (c: Context<AppEnv>): Promise<SessionResolution<MemberSession>> => {
  const token = bearerToken(c)
  return token === '' ? { kind: 'invalid' } : await resolveMemberSession(c.get('db'), token, c.get('now')())
}
