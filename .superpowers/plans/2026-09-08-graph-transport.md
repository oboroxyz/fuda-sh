# Graph Transport Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove duplicate announcement HTTP parsing by reusing the SDK's existing postGraph function.

**Architecture:** Keep all code in graph.ts. Share transport and response validation while retaining the separate announcement cursor loop and ID-only page loop.

**Tech Stack:** TypeScript, fetch, Valibot, Vitest, Vite+, pnpm.

**Spec:** `.superpowers/specs/2026-09-08-graph-transport-design.md`

## Global Constraints

- Keep all SDK exports, signatures, error messages, query strings, and PAGE_SIZE = 1000 unchanged.
- Preserve announcement `(afterBlock, afterId)` cursor semantics, inclusive fromBlock behavior, final sorting, and bigint precision.
- Preserve ID-only pagination for rights, attendances, and delegations.
- Preserve AbortSignal forwarding and rejection of GraphQL errors even alongside partial data.
- Add no dependencies, retries, caches, cursor redesign, or workspace packages.

---

### Task 1: Use postGraph for announcements

**Files:**

- Modify: `packages/sdk/src/graph.ts` (`fetchAnnouncements`, currently lines 346–403)
- Test: `packages/sdk/src/graph.test.ts`

**Interfaces:**

- Consumes: existing private `postGraph<TOutput>(schema, endpoint, query, variables, signal?): Promise<TOutput>`.
- Produces: no new exports; `fetchAnnouncements(endpoint, fromBlock, signal?)` remains unchanged.

- [ ] **Step 1: Read repository instructions and establish the baseline.** Read the spec and both files. Use the current checkout unless isolation was requested and preserve pre-existing changes. Run `pnpm --filter @fuda/sdk test --run src/graph.test.ts` if content changed since diagnosis; observed baseline was 25 tests passed. A behavior-preserving extraction starts from green characterization tests.

- [ ] **Step 2: Pin the request envelope at the public interface.** Add this test inside the existing fetchAnnouncements describe block, unless an equivalent exact assertion already exists:

```ts
it('posts the announcement cursor and caller signal', async () => {
  const request = vi.fn<typeof fetch>().mockResolvedValue(
    Response.json({ data: { announcements: [] } }),
  )
  vi.stubGlobal('fetch', request)
  const controller = new AbortController()
  await fetchAnnouncements('https://graph.example/rights', 123n, controller.signal)
  expect(request).toHaveBeenCalledOnce()
  const [endpoint, init] = request.mock.calls[0]!
  expect(endpoint).toBe('https://graph.example/rights')
  expect(init).toMatchObject({
    headers: { 'content-type': 'application/json' },
    method: 'POST',
    signal: controller.signal,
  })
  const body = JSON.parse(init!.body as string)
  expect(body.variables).toStrictEqual({ afterBlock: '122', afterId: '0x', first: 1000 })
  expect(body.query).toContain('query Announcements')
})
```

Run the graph tests; expected pass before and after extraction. Retain the existing tests for GraphQL partial errors, malformed data, bigint precision, HTTP failures, pagination and cancellation. Do not mock the private helper itself.

- [ ] **Step 3: Replace only the duplicated request/parser block.** Within the announcement while loop, replace fetch/status/JSON/safeParse with:

```ts
// oxlint-disable-next-line no-await-in-loop -- each announcement page starts at the previous page's cursor
const body = await postGraph(
  ResponseSchema,
  endpoint,
  ANNOUNCEMENTS_QUERY,
  { afterBlock: afterBlock.toString(), afterId, first: PAGE_SIZE },
  signal,
)
if ('errors' in body) {
  throw graphErrors(body.errors)
}
const page = body.data.announcements
```

Keep the existing `rows.push`, break condition, cursor updates, and final `toSorted` unchanged. Remove obsolete duplicate comments and variables. Leave GraphQL-error interpretation at the caller and preserve negative-fromBlock validation before network access.

- [ ] **Step 4: Verify and review.** Run `pnpm --filter @fuda/sdk test --run src/graph.test.ts` (expected baseline plus new test pass), then root `pnpm check`, `pnpm test`, and `git diff --check`. Inspect the diff to ensure query text, exports, cursor comparison and conversion functions are unchanged. This is not a live Graph endpoint validation.

- [ ] **Step 5: Record completion under the execution session's Git authorization.** Commit only graph source/test changes with `refactor(sdk): reuse graph transport for announcements`. Do not create a branch automatically on main. No canonical spec update is needed because observable behavior is unchanged.

- [ ] **Step 6: Remove completed temporary artifacts.** Delete this plan and its Graph design after implementation and verification. Preserve other active plans. Artifact-only deletion needs `git diff --check`; do not repeat unchanged full verification.
