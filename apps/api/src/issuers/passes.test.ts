import { ISSUER_PASS_STATUSES, rightStatus } from '@fuda/sdk'
import type { RightFacts } from '@fuda/sdk'
import { env } from 'cloudflare:test'
import { describe, expect, it } from 'vitest'

import { readIssuerPasses } from './passes.ts'

describe(readIssuerPasses, () => {
  it('keeps SQL display, filtering and counts equal to rightStatus for every combination', async () => {
    const now = 100
    const expected = new Map<string, ReturnType<typeof rightStatus>['status']>()
    const statements: D1PreparedStatement[] = []
    for (const status of ['active', 'revoked'] as const) {
      for (const usageModel of [null, 0, 1, 2, 3]) {
        for (const validFrom of [null, 0, now, now + 1]) {
          for (const validUntil of [null, 0, now, now - 1]) {
            for (const consumed of [false, true]) {
              for (const expiry of [null, 0, now, now - 1]) {
                const uid = `status-${expected.size}`
                const facts: RightFacts = { consumed, status, usageModel, validFrom, validUntil }
                if (expiry !== null) {
                  facts.expirationTime = BigInt(expiry)
                  statements.push(
                    env.DB.prepare(
                      'INSERT INTO offchain_attestations (uid, signed, created_at) VALUES (?, ?, 0)',
                    ).bind(uid, JSON.stringify({ message: { expirationTime: String(expiry) } })),
                  )
                }
                expected.set(uid, rightStatus(facts, now).status)
                statements.push(
                  env.DB.prepare(
                    "INSERT INTO members (attestation_uid, member_id, issuer_id, level, created_at, status, usage_model, valid_from, valid_until) VALUES (?, ?, 'status-issuer', 'bearer', 0, ?, ?, ?, ?)",
                  ).bind(uid, uid, status, usageModel, validFrom, validUntil),
                )
                if (consumed) {
                  statements.push(
                    env.DB.prepare(
                      "INSERT INTO slots (uid, slot, consumed_at) VALUES (?, 'default', 0)",
                    ).bind(uid),
                  )
                }
              }
            }
          }
        }
      }
    }
    for (let offset = 0; offset < statements.length; offset += 50) {
      // oxlint-disable-next-line no-await-in-loop -- bounded D1 batches share one database
      await env.DB.batch(statements.slice(offset, offset + 50))
    }
    const filters = { cardId: null, page: 1, pageSize: expected.size, q: '', source: null, status: null }
    const all = await readIssuerPasses(env.DB, 'status-issuer', now, filters)
    expect(all.passes).toHaveLength(expected.size)
    for (const row of all.passes) {
      expect(row.status).toBe(expected.get(row.uid))
    }
    for (const status of ISSUER_PASS_STATUSES) {
      // oxlint-disable-next-line no-await-in-loop -- compare each SQL filter against the same fixtures
      const result = await readIssuerPasses(env.DB, 'status-issuer', now, { ...filters, status })
      const count = [...expected.values()].filter((value) => value === status).length
      expect(result.page.total).toBe(count)
      expect(result.passes).toHaveLength(count)
      expect(result.passes.every((row) => row.status === status)).toBe(true)
      expect(result.summary.active).toBe([...expected.values()].filter((value) => value === 'active').length)
      expect(result.summary.unknown).toBe(
        [...expected.values()].filter((value) => value === 'unknown').length,
      )
    }
  })
})
