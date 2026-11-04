import { describe, expect, it } from 'vitest'

import { cameraMode, venueHandle } from './config.ts'

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

describe(venueHandle, () => {
  it('reads the handle from the flag', () => {
    expect(venueHandle('?venue=blue-bottle')).toBe('blue-bottle')
    expect(venueHandle('?camera=off&venue=blue-bottle')).toBe('blue-bottle')
  })

  it('forgives a leading @, capitals and surrounding spaces', () => {
    expect(venueHandle('?venue=@Blue-Bottle')).toBe('blue-bottle')
    expect(venueHandle('?venue=%20blue-bottle%20')).toBe('blue-bottle')
  })

  it('is null when the flag is missing or empty', () => {
    expect(venueHandle('')).toBeNull()
    expect(venueHandle('?camera=off')).toBeNull()
    expect(venueHandle('?venue=')).toBeNull()
    expect(venueHandle('?venue=@')).toBeNull()
    expect(venueHandle('?venue=%20')).toBeNull()
  })

  it('keeps a value no shop can hold, so the api can reject it', () => {
    expect(venueHandle('?venue=not%20a%20handle')).toBe('not a handle')
  })
})
