import { describe, expect, it } from 'vitest'

import { cameraMode } from './config.ts'

describe(cameraMode, () => {
  it('turns the camera off only for the exact flag', () => {
    expect(cameraMode('?camera=off')).toBe('off')
    expect(cameraMode('?lang=ja&camera=off')).toBe('off')
  })

  it('keeps the camera for anything else', () => {
    expect(cameraMode('')).toBe('auto')
    expect(cameraMode('?camera=on')).toBe('auto')
    expect(cameraMode('?camera=')).toBe('auto')
    expect(cameraMode('?camera=OFF')).toBe('auto')
    expect(cameraMode('?kiosk=1')).toBe('auto')
  })
})
