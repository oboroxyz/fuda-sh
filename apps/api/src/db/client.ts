import { drizzle } from 'drizzle-orm/d1'
import type { DrizzleD1Database } from 'drizzle-orm/d1'

import type { Bindings } from '../env.ts'
import * as schema from './schema.ts'

export type Db = DrizzleD1Database<typeof schema>

export const getDb = (env: Pick<Bindings, 'DB'>): Db => drizzle(env.DB, { schema })
