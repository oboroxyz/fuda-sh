import { describe, expect, it, vi } from 'vitest'

import {
  applyThemeMode,
  nextThemeMode,
  readThemeMode,
  resolveThemeMode,
  saveThemeMode,
  themeScript,
  watchThemeMode,
} from './theme.ts'
import type { ThemeEnvironment } from './theme.ts'

const environment = (stored: string | null, dark = false): ThemeEnvironment => ({
  applyRoot: vi.fn<ThemeEnvironment['applyRoot']>(),
  prefersDark: vi.fn<ThemeEnvironment['prefersDark']>(() => dark),
  readStored: vi.fn<ThemeEnvironment['readStored']>(() => stored),
  subscribeSystem: vi.fn<ThemeEnvironment['subscribeSystem']>(() => () => {}),
  writeStored: vi.fn<ThemeEnvironment['writeStored']>(),
})

describe('theme preference', () => {
  it('defaults invalid or absent data to system and cycles light to dark to system', () => {
    expect(resolveThemeMode(null)).toBe('system')
    expect(resolveThemeMode('sepia')).toBe('system')
    expect(nextThemeMode('light')).toBe('dark')
    expect(nextThemeMode('dark')).toBe('system')
    expect(nextThemeMode('system')).toBe('light')
  })

  it('applies the selected mode and resolved dark state', () => {
    const env = environment('system', true)
    applyThemeMode('system', env)
    expect(env.applyRoot).toHaveBeenCalledWith('system', true)
  })

  it('applies even when saving is blocked', () => {
    const env = environment(null)
    env.writeStored = () => {
      throw new Error('blocked')
    }
    saveThemeMode('dark', env)
    expect(env.applyRoot).toHaveBeenCalledWith('dark', true)
  })

  it('subscribes only in system mode and reapplies preference changes', () => {
    const env = environment('system')
    const listener = vi.fn<() => void>()
    const unsubscribe = vi.fn<() => void>()
    vi.spyOn(env, 'subscribeSystem').mockImplementation((next) => {
      listener.mockImplementation(next)
      return unsubscribe
    })
    const stop = watchThemeMode('system', env)
    expect(env.subscribeSystem).toHaveBeenCalledOnce()
    listener()
    expect(env.applyRoot).toHaveBeenCalledWith('system', false)
    stop()
    expect(unsubscribe).toHaveBeenCalledOnce()
    expect(watchThemeMode('dark', env)).toBeTypeOf('function')
  })

  it('reads system when storage access throws', () => {
    const env = environment(null)
    env.readStored = () => {
      throw new Error('blocked')
    }
    expect(readThemeMode(env)).toBe('system')
  })
})

describe(themeScript, () => {
  it('passes the mode to the inline script as a JSON string', () => {
    expect(themeScript('dark')).toMatch(/\("dark"\)$/u)
  })

  it('falls back to system for a value outside the known modes', () => {
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- simulates an unvalidated runtime value
    const script = themeScript('</script><script>alert(1)</script>' as 'dark')
    expect(script).not.toContain('</script>')
    expect(script).toMatch(/\("system"\)$/u)
  })
})
