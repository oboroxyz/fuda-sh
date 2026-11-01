import { defineHandler } from 'void'

export const root = defineHandler((c) => c.text('fuda. api\nhealth: ok\n'))
export const health = defineHandler((c) => c.json({ ok: true }))
