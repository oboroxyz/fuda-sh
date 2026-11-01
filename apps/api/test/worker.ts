// The workerd pool requires an entry even when tests call handlers directly.
export default { fetch: () => new Response(null, { status: 404 }) }
