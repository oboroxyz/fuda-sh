import * as v from 'valibot'
import { describe, expect, it } from 'vitest'

import { ConnectedAppBody, normalizeRedirectUri, parseScope } from './connected-apps.ts'

describe(normalizeRedirectUri, () => {
  it('accepts https anywhere and http only on this machine', () => {
    expect(normalizeRedirectUri('https://shop.figma.site')).toBe('https://shop.figma.site/')
    expect(normalizeRedirectUri('https://shop.figma.site/cb?x=1')).toBe('https://shop.figma.site/cb?x=1')
    expect(normalizeRedirectUri('http://localhost:5173/cb')).toBe('http://localhost:5173/cb')
    expect(normalizeRedirectUri('http://127.0.0.1:4000/')).toBe('http://127.0.0.1:4000/')
    expect(normalizeRedirectUri('http://shop.example/cb')).toBeNull()
  })

  it('refuses fragments, credentials and things that are not web URLs', () => {
    const refused = [
      'https://shop.example/cb#done',
      'https://shop.example/cb#',
      'https://me:pw@shop.example/cb',
      'data:text/html,hi',
      '/cb',
      '',
    ].map(normalizeRedirectUri)
    expect(refused).toStrictEqual([null, null, null, null, null, null])
  })
})

describe(parseScope, () => {
  it('reads a space-separated list in canonical order, empty meaning all', () => {
    expect(parseScope('  ')).toStrictEqual(['cards:read', 'cards:write'])
    expect(parseScope('')).toStrictEqual(['cards:read', 'cards:write'])
    expect(parseScope('cards:write cards:read')).toStrictEqual(['cards:read', 'cards:write'])
    expect(parseScope('cards:read')).toStrictEqual(['cards:read'])
  })

  it('refuses unknown and repeated names', () => {
    expect(parseScope('cards:read passes:write')).toBeNull()
    expect(parseScope('cards:read cards:read')).toBeNull()
  })
})

describe('connected app registration body', () => {
  it('needs a name and one to five distinct redirect URIs', () => {
    const ok = { name: 'Shop app', redirectUris: ['https://shop.figma.site/'] }
    expect(v.safeParse(ConnectedAppBody, ok).success).toBe(true)
    expect(v.safeParse(ConnectedAppBody, { ...ok, redirectUris: [] }).success).toBe(false)
    expect(
      v.safeParse(ConnectedAppBody, {
        ...ok,
        redirectUris: ['https://shop.figma.site', 'https://shop.figma.site/'],
      }).success,
    ).toBe(false)
    expect(v.safeParse(ConnectedAppBody, { ...ok, name: '  ' }).success).toBe(false)
    expect(v.safeParse(ConnectedAppBody, { ...ok, redirectUris: ['http://shop.example/'] }).success).toBe(
      false,
    )
  })
})
