import { createApp } from './app.ts'
import { createViemChain } from './chain/viem-chain.ts'
import type { Bindings } from './env.ts'

// Production entry. The chain client is built per request from bindings.
export default {
  fetch(request: Request, env: Bindings, ctx: ExecutionContext): Promise<Response> {
    const app = createApp({ chain: createViemChain(env) })
    return Promise.resolve(app.fetch(request, env, ctx))
  },
}
