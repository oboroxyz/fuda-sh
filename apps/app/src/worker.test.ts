import path from 'node:path'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { TestHarness } from 'wrangler'
import { createTestHarness } from 'wrangler'

const harness: TestHarness = createTestHarness({
  root: path.join(import.meta.dirname, '..'),
  workers: [{ configPath: './wrangler.jsonc' }],
})

describe('app Worker routing', () => {
  beforeAll(async () => {
    await harness.listen()
  })

  afterAll(async () => {
    await harness.close()
  })

  it('serves the SPA shell without encoding the @ handle path', async () => {
    const response = await harness.fetch('https://app.fuda.sh/@test?source=qr', {
      headers: { 'Sec-Fetch-Mode': 'navigate' },
      redirect: 'manual',
    })

    expect(response.status).toBe(200)
    expect(response.headers.get('location')).toBeNull()
    expect(response.headers.get('content-type')).toBe('text/html; charset=utf-8')
    await expect(response.text()).resolves.toContain('<div id="root"></div>')
  })
})
