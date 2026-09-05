import { describe, expect, it } from 'vitest'

import { corsPolicy } from '../src/middleware/cors.ts'
import { appWith, testEnv } from './env.ts'

const ALLOWED_ORIGINS = [
  'https://app.fuda.sh',
  'https://dash.fuda.sh',
  'https://gate.fuda.sh',
  'http://localhost:5173',
]

describe(corsPolicy, () => {
  it('allows the three fuda hosts and a localhost dev port, not others', async () => {
    const app = appWith({ chain: {} })
    const responses = await Promise.all(
      ALLOWED_ORIGINS.map((origin) => app.request('/health', { headers: { Origin: origin } }, testEnv())),
    )
    expect(responses.map((res) => res.headers.get('access-control-allow-origin'))).toStrictEqual(
      ALLOWED_ORIGINS,
    )
    const bad = await app.request('/health', { headers: { Origin: 'https://evil.example' } }, testEnv())
    expect(bad.headers.get('access-control-allow-origin')).toBeNull()
  })
})
