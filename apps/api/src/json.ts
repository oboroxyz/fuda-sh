import type { Context } from 'hono'
import type { ContentfulStatusCode } from 'hono/utils/http-status'

const MAX = BigInt(Number.MAX_SAFE_INTEGER)

export const toJsonSafe = (
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- converts arbitrary values to JSON-safe representation
  value: unknown,
  // oxlint-disable-next-line anti-slop/no-unknown-returns -- intentional: returns unknown for JSON serialization
): unknown => {
  // oxlint-disable-next-line anti-slop/no-runtime-typeof -- type guards required for dynamic value conversion
  if (typeof value === 'bigint') {
    return value <= MAX && value >= -MAX ? Number(value) : value.toString()
  }
  if (Array.isArray(value)) {
    return value.map(toJsonSafe)
  }
  // oxlint-disable-next-line anti-slop/no-runtime-typeof -- type guards required for dynamic value conversion
  if (value !== null && typeof value === 'object') {
    // oxlint-disable-next-line anti-slop/no-unsafe-dictionary-type -- converts untyped objects to safe representation
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value)) {
      out[k] = toJsonSafe(v)
    }
    // oxlint-disable-next-line anti-slop/no-known-value-widening -- intentional: returns unknown for JSON serialization
    return out
  }
  return value
}

// oxlint-disable-next-line anti-slop/no-unknown-parameters -- converts arbitrary values to JSON-safe equivalents
export const jsonResponse = (c: Context, body: unknown, status: ContentfulStatusCode = 200): Response =>
  c.json(toJsonSafe(body), status)

export const errorResponse = (c: Context, error: string, status: ContentfulStatusCode): Response =>
  c.json({ error }, status)
