// Gate scan (scan-admit, scan-already-used, scan-no-venue): a single-use Bearer
// Right is admitted once from the paste box, then reads as already used, and
// D1 holds one consumed slot and both log rows. Recipe and gotchas:
// .agents/skills/verify-fuda/features/gate-scan.md
import * as v from 'valibot'

import type { Journey } from '../scripts/verify.ts'

const PASTE_BOX = 'paste fuda:v1:… or 0x…'
const EntrySchema = v.array(v.object({ decision: v.string(), path: v.string(), reason: v.string() }))

const journey: Journey = {
  run: async ({ apiRequest, check, d1, note, page, seed, step }) => {
    const right = await seed.bearer()
    note('seededRight', right)
    // The uid is interpolated into SQL below, so hold it to its hex shape.
    check(/^0x[0-9a-f]{64}$/u.test(right.uid), 'seeded uid is a hex uid')

    await page.goto('/')
    await page.getByText(/no venue set/u).waitFor()
    await step('scanner-ready')

    await page.getByRole('textbox', { name: PASTE_BOX }).fill(right.qr)
    await step('qr-entered')
    await page.getByRole('button', { name: 'Check' }).click()
    const verdict = page.getByRole('button', { name: /tap to scan again/u })
    await verdict.filter({ hasText: 'ADMIT' }).waitFor()
    await step('first-scan-admit')

    await verdict.click()
    await page.getByRole('textbox', { name: PASTE_BOX }).fill(right.qr)
    await page.getByRole('button', { name: 'Check' }).click()
    await verdict.filter({ hasText: 'ALREADY_USED' }).waitFor()
    const shown = await verdict.textContent()
    check(shown?.includes('REJECT') === true, 'second scan shows REJECT')
    await step('second-scan-already-used')

    // Side effects, read from D1 rather than from the screen.
    const slots = d1(`select slot from slots where uid = '${right.uid}'`)
    note('slots', slots)
    check(slots.length === 1, 'exactly one slot consumed')
    const entries = v.parse(
      EntrySchema,
      d1(`select decision, reason, path from entry_log where uid = '${right.uid}' order by id`),
    )
    note('entryLog', entries)
    check(
      entries.map((row) => `${row.path}:${row.decision}:${row.reason}`).join(' ') ===
        'qr:ADMIT:OK qr:REJECT:ALREADY_USED',
      'entry log holds ADMIT then ALREADY_USED',
    )

    // The preview never reads the slot (docs/specs/attestation-model.md), so it
    // still answers ADMIT. Recorded so nobody mistakes that for a regression.
    const preview = await apiRequest(
      `/verify/${right.uid}`,
      v.object({ decision: v.string(), reason: v.optional(v.string()) }),
    )
    note('previewAfterAdmission', preview)
  },
  surface: 'gate',
  // A tablet in landscape, the size of station the gate is built for.
  viewport: { height: 768, width: 1024 },
}

export default journey
