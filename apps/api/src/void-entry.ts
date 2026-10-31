import { defineMiddleware } from 'void'

import worker from './index.ts'
import type { DevBindings } from './index.ts'

// Void types `c.env` by the bindings it infers itself. The api's come from its
// target block in targets.jsonc and the Worker secrets, so declare them here.
declare global {
  // oxlint-disable-next-line typescript/no-empty-interface, typescript/no-empty-object-type -- global interface merge is the only way to add bindings to Void's env type
  interface VoidGeneratedEnvBindings extends DevBindings {}
}

// Void serves the api through one middleware that hands every request to the
// Worker entry, so routing stays in app.ts and the tests still drive
// `createApp` directly. Each `targets/<name>/middleware/api.ts` re-exports this.
export default defineMiddleware(async (c) => {
  // SAFETY: the Worker's ExecutionContext, passed through by Hono.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- Hono's ExecutionContext type lacks workers-types' `tracing`
  const ctx = c.executionCtx as ExecutionContext
  return await worker.fetch(c.req.raw, c.env, ctx)
})
