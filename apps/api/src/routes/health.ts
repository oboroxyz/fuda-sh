import { Hono } from 'hono'

import type { AppEnv } from '../env.ts'

export const health = new Hono<AppEnv>()
  .get('/', (c) => c.text('fuda. api\nhealth: ok\n'))
  .get('/health', (c) => c.json({ ok: true }))
