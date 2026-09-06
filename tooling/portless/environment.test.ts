import { describe, expect, it } from 'vitest'

import { deriveApiOrigin, parseServiceEnvironment } from './environment.ts'

const app = { name: 'app', path: 'apps/app' } as const

describe(deriveApiOrigin, () => {
  it.each([
    ['https://app.localhost', 'https://api.localhost'],
    ['https://feature-auth.app.localhost', 'https://feature-auth.api.localhost'],
    ['http://app.localhost:1355', 'http://api.localhost:1355'],
  ])('derives the matching API origin from %s', (input, expected) => {
    expect(deriveApiOrigin(input, 'app')).toBe(expected)
  })

  it.each([
    'https://gate.localhost',
    'https://one.two.app.localhost',
    'https://user:pass@app.localhost',
    'https://app.localhost/path',
    'https://app.localhost?query=yes',
    'https://app.example.com',
  ])('rejects an unsupported app URL: %s', (input) => {
    expect(() => deriveApiOrigin(input, 'app')).toThrow(/PORTLESS_URL/u)
  })
})

describe(parseServiceEnvironment, () => {
  it('parses a complete loopback service environment', () => {
    expect(
      parseServiceEnvironment(app, {
        HOST: '127.0.0.1',
        PORT: '4321',
        PORTLESS_URL: 'https://app.localhost',
      }),
    ).toMatchObject({
      apiOrigin: 'https://api.localhost',
      host: '127.0.0.1',
      hostname: 'app.localhost',
      port: 4321,
      publicOrigin: 'https://app.localhost',
    })
  })

  it.each([
    ['missing port', { HOST: '127.0.0.1', PORTLESS_URL: 'https://app.localhost' }, /PORT/u],
    ['port zero', { HOST: '127.0.0.1', PORT: '0', PORTLESS_URL: 'https://app.localhost' }, /PORT/u],
    [
      'port above range',
      { HOST: '127.0.0.1', PORT: '65536', PORTLESS_URL: 'https://app.localhost' },
      /PORT/u,
    ],
    [
      'non-integer port',
      { HOST: '127.0.0.1', PORT: '4321.5', PORTLESS_URL: 'https://app.localhost' },
      /PORT/u,
    ],
    ['non-loopback host', { HOST: '0.0.0.0', PORT: '4321', PORTLESS_URL: 'https://app.localhost' }, /HOST/u],
    [
      'URL/name mismatch',
      { HOST: '127.0.0.1', PORT: '4321', PORTLESS_URL: 'https://gate.localhost' },
      /PORTLESS_URL/u,
    ],
  ])('rejects a %s', (_description, env, error) => {
    expect(() => parseServiceEnvironment(app, env)).toThrow(error)
  })
})
