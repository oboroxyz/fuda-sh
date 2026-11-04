import { defineScheduled } from 'void'

import { getDb } from '../db/client.ts'
import { buildChain } from '../runtime.ts'
import { anchorOffchainRoots, retryOffchainRevocations } from './offchain-chores.ts'

// The schedules live beside these under crons/, the directory Void discovers.
export const offchainRootsJob = defineScheduled(async (controller, env) => {
  await anchorOffchainRoots(getDb(env), buildChain(env), Math.floor(controller.scheduledTime / 1000))
})

export const offchainRevocationsJob = defineScheduled(async (_controller, env) => {
  await retryOffchainRevocations(getDb(env), buildChain(env))
})
