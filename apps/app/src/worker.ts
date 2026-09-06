export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    return await env.ASSETS.fetch(new URL('/', request.url))
  },
} satisfies ExportedHandler<Env>
