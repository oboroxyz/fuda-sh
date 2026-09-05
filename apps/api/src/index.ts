import { createApp } from './app.ts'
import type { Bindings } from './env.ts'

// Production entry. The chain client is built per request from bindings in
// Task 7; until then the app runs with an empty chain object.
export default {
  fetch(request: Request, env: Bindings, ctx: ExecutionContext): Promise<Response> {
    const app = createApp({ chain: {} })
    return Promise.resolve(app.fetch(request, env, ctx))
  },
}
