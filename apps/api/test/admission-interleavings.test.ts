import type { Hex, VerifyResponse } from '@fuda/sdk'
import { USAGE_MODEL } from '@fuda/sdk'
// Bounded exhaustive check of two promises under every interleaving of a few
// concurrent requests (.agents/skills/verify-admission/SKILL.md):
//   - a SINGLE_USE pass is admitted at most once, across gate scans, reception
//     scans and reception retries;
//   - stamps on a Tokyo day never exceed that day's daily limit, across
//     reception scans, retries, a limit change and midnight.
// Each request is cut into the steps its handler takes between awaits that
// matter (handlers/verify.ts, handlers/reception.ts). A D1 batch or a single
// statement is one step, as D1 commits it atomically. Every merge of the
// requests' step sequences runs against the real store functions on a reset
// D1, and the properties are checked after each.
import { env } from 'cloudflare:test'
import { and, eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it } from 'vitest'

import { getDb } from '../src/db/client.ts'
import {
  cardStampSettings,
  cards,
  entryLog,
  issuers,
  members,
  receptionRequests,
  slots,
  stampCredits,
} from '../src/db/schema.ts'
import { readReception, recordReception } from '../src/stamps/reception-store.ts'
import { japanDay } from '../src/stamps/store.ts'
import { admitSingleUse, logEntry } from '../src/verify/admit.ts'
import { HOLDER, NOW } from './fixtures.ts'

const db = getDb({ DB: env.DB })
const ISSUER = 'issuer-interleavings'
const CARD = 'card-interleavings'
const SINGLE_USE_UID: Hex = `0x${'a1'.repeat(32)}`
const MEMBERSHIP_UID: Hex = `0x${'b2'.repeat(32)}`
const OPERATOR = 'operator:interleavings'
// Ten seconds before a Tokyo midnight, so one clock tick changes the day.
const MIDNIGHT = (Math.floor((NOW + 9 * 3600) / 86_400) + 1) * 86_400 - 9 * 3600
const BEFORE_MIDNIGHT = MIDNIGHT - 10
const AFTER_MIDNIGHT = MIDNIGHT + 10
// What resolveVerdict and qrOutcome hand recordReception for a valid level-0 right.
const ADMIT_VERDICT: VerifyResponse = { decision: 'ADMIT', reason: 'OK' }

interface World {
  clock: number
  limit: number
  // The highest daily limit in force at any moment while each Tokyo day was current.
  limitDuring: Map<string, number>
  // Per user-visible request (a gate scan, or one reception request id), whether it showed ADMIT.
  shown: Map<string, boolean>
  // The reception responses each request id returned, replays included.
  responses: Map<string, string[]>
}

interface Step {
  label: string
  // A clock or local step is synchronous; a D1 step returns its promise.
  run: (world: World) => Promise<void> | void
}

// POST /v1/verify for a SINGLE_USE right: admitAndHook → admitSingleUse is one
// batch; on ALREADY_USED the handler logs the REJECT with a second statement.
// Its clock read is folded into the batch: no gate scenario moves the clock.
const gateScan = (name: string, uid: Hex): Step[] => [
  {
    label: `${name}.admit`,
    run: async (world) => {
      const at = world.clock
      const outcome = await admitSingleUse(db, uid, 'qr', at)
      world.shown.set(name, outcome.admitted)
      if (!outcome.admitted) {
        await logEntry(db, { at, decision: 'REJECT', path: 'qr', reason: 'ALREADY_USED', uid })
      }
    },
  },
]

interface ReceptionOptions {
  name: string
  requestId: string
  uid: Hex
  singleUse: boolean
  // Whether the request reads a stored receipt first. Every request does; the
  // read is left out only where no other request in the scenario shares its id.
  replayCheck: boolean
  // Whether the clock read is its own step. Left out only where nothing in the
  // scenario moves the clock, so reading it at the batch is the same.
  readsClock: boolean
}

// POST /v1/issuers/me/reception: readReception, then the clock, then (after the
// chain read) recordReception's one batch, then the receipt read.
const receptionScan = (options: ReceptionOptions): Step[] => {
  const { name, requestId, uid, singleUse, replayCheck, readsClock } = options
  const id = `${ISSUER}:${requestId}`
  let replayed = false
  let at: number | null = null
  const answer = (world: World, response: VerifyResponse): void => {
    world.shown.set(requestId, (world.shown.get(requestId) ?? false) || response.decision === 'ADMIT')
    world.responses.set(requestId, [...(world.responses.get(requestId) ?? []), JSON.stringify(response)])
  }
  const clockStep: Step = {
    label: `${name}.readClock`,
    run: (world) => {
      at = world.clock
    },
  }
  const steps: Step[] = [
    ...(readsClock ? [clockStep] : []),
    {
      label: `${name}.record`,
      run: async (world) => {
        if (replayed) {
          return
        }
        const { receipt } = await recordReception(env.DB, db, {
          id,
          issuerId: ISSUER,
          now: at ?? world.clock,
          operatorKey: OPERATOR,
          singleUse,
          uid,
          verdict: ADMIT_VERDICT,
        })
        answer(world, receipt.response)
      },
    },
  ]
  if (!replayCheck) {
    return steps
  }
  return [
    {
      label: `${name}.readReceipt`,
      run: async (world) => {
        const previous = await readReception(db, id)
        if (previous !== undefined) {
          replayed = true
          answer(world, previous.response)
        }
      },
    },
    ...steps,
  ]
}

// PUT /v1/issuers/me/cards/:cardId/stamps is one upsert statement.
const raiseLimit = (to: number): Step[] => [
  {
    label: `raiseLimit(${String(to)})`,
    run: async (world) => {
      await db.update(cardStampSettings).set({ dailyLimit: to }).where(eq(cardStampSettings.cardId, CARD))
      world.limit = to
      const today = japanDay(world.clock)
      world.limitDuring.set(today, Math.max(world.limitDuring.get(today) ?? 0, to))
    },
  },
]

const midnight: Step[] = [
  {
    label: 'clock passes midnight',
    run: (world) => {
      world.clock = AFTER_MIDNIGHT
      const today = japanDay(world.clock)
      world.limitDuring.set(today, Math.max(world.limitDuring.get(today) ?? 0, world.limit))
    },
  },
]

// Every merge of the sequences that keeps each one's own order, as lists of
// sequence indexes: [0, 1, 0] runs sequence 0's first step, then 1's, then 0's.
const merges = (lengths: readonly number[]): number[][] => {
  if (lengths.every((left) => left === 0)) {
    return [[]]
  }
  return lengths.flatMap((left, index) => {
    if (left === 0) {
      return []
    }
    const rest = lengths.map((value, at) => (at === index ? value - 1 : value))
    return merges(rest).map((tail) => [index, ...tail])
  })
}

const reset = async (limit: number): Promise<void> => {
  await db.delete(stampCredits)
  await db.delete(receptionRequests)
  await db.delete(entryLog)
  await db.delete(slots)
  await db.update(cardStampSettings).set({ dailyLimit: limit }).where(eq(cardStampSettings.cardId, CARD))
}

interface Violation {
  message: string
  labels: string[]
}

interface Explored {
  schedules: number
  violations: Violation[]
}

// The first few violations, readable in an assertion diff.
const shown = (violations: readonly Violation[]): string[] =>
  violations.slice(0, 3).map(({ message, labels }) => `${message}\n    after: ${labels.join(' → ')}`)

// Runs every schedule of the scenario and returns each one that breaks a property.
const explore = async (
  build: () => Step[][],
  limit: number,
  check: (world: World) => Promise<string | null>,
): Promise<Explored> => {
  const schedules = merges(build().map((sequence) => sequence.length))
  const violations: Violation[] = []
  for (const schedule of schedules) {
    // oxlint-disable-next-line no-await-in-loop -- schedules share one D1 and must run one at a time
    await reset(limit)
    const sequences = build()
    const cursor = sequences.map(() => 0)
    const world: World = {
      clock: BEFORE_MIDNIGHT,
      limit,
      limitDuring: new Map([[japanDay(BEFORE_MIDNIGHT), limit]]),
      responses: new Map(),
      shown: new Map(),
    }
    const labels: string[] = []
    for (const index of schedule) {
      const position = cursor[index] ?? 0
      const step = sequences[index]?.[position]
      if (step === undefined) {
        throw new Error(`schedule ran past sequence ${String(index)}`)
      }
      cursor[index] = position + 1
      labels.push(step.label)
      // oxlint-disable-next-line no-await-in-loop -- the order of these awaits is the schedule under test
      await step.run(world)
    }
    // oxlint-disable-next-line no-await-in-loop -- reads this schedule's final D1 state before the next reset
    const broken = await check(world)
    if (broken !== null) {
      violations.push({ labels, message: broken })
    }
  }
  return { schedules: schedules.length, violations }
}

const seed = async (): Promise<void> => {
  await db.delete(stampCredits)
  await db.delete(receptionRequests)
  await db.delete(entryLog)
  await db.delete(slots)
  await db.delete(cardStampSettings)
  await db.delete(members)
  await db.delete(cards)
  await db.delete(issuers)
  await db.insert(issuers).values({
    brandColor: '#112233',
    createdAt: NOW,
    handle: 'interleavings',
    id: ISSUER,
    name: 'Interleavings',
    operatorAddress: HOLDER,
  })
  await db.insert(cards).values({
    category: 'membership',
    createdAt: NOW,
    id: CARD,
    issuerId: ISSUER,
    slug: 'interleavings',
    title: 'Interleavings membership',
  })
  await db.insert(cardStampSettings).values({ cardId: CARD, dailyLimit: 1, enabled: true, goal: 10 })
  for (const [uid, memberId] of [
    [SINGLE_USE_UID, 'single-use'],
    [MEMBERSHIP_UID, 'membership'],
  ] as const) {
    // oxlint-disable-next-line no-await-in-loop -- two seed rows, inserted in order
    await db.insert(members).values({
      attestationUid: uid,
      cardId: CARD,
      createdAt: NOW,
      holder: HOLDER,
      issuerId: ISSUER,
      level: 'bearer',
      memberId,
    })
  }
}

const countRows = async (uid: Hex) => {
  const admits = await db
    .select()
    .from(entryLog)
    .where(and(eq(entryLog.uid, uid), eq(entryLog.decision, 'ADMIT')))
  const used = await db.select().from(slots).where(eq(slots.uid, uid))
  return { admits: admits.length, slots: used.length }
}

// The schedules in which a scan reads the clock before midnight and records
// after the raised limit: its stamp lands on the old day under the new limit.
const STALE_DAY_SCHEDULES = 14

const staleDayAfterRaise = (labels: readonly string[]): boolean => {
  const midnightAt = labels.indexOf('clock passes midnight')
  const raisedAt = labels.indexOf('raiseLimit(2)')
  return ['scanA', 'scanB'].some((scan) => {
    const readAt = labels.indexOf(`${scan}.readClock`)
    const recordAt = labels.indexOf(`${scan}.record`)
    return readAt < midnightAt && midnightAt < raisedAt && raisedAt < recordAt
  })
}

const dailyCapCheck = async (world: World): Promise<string | null> => {
  const credits = await db.select().from(stampCredits).where(eq(stampCredits.uid, MEMBERSHIP_UID))
  const perDay = new Map<string, number>()
  for (const credit of credits) {
    perDay.set(credit.day, (perDay.get(credit.day) ?? 0) + 1)
  }
  for (const [day, count] of perDay) {
    const limit = world.limitDuring.get(day) ?? 0
    if (count > limit) {
      return `${String(count)} stamps on ${day}, whose daily limit was at most ${String(limit)} while it was the current day`
    }
  }
  return null
}

// Each test replays every schedule against D1; under a loaded CI runner one
// can take longer than Vitest's default 5 s.
describe('admission and stamp promises under every interleaving', { timeout: 30_000 }, () => {
  beforeEach(seed)

  it('admits a SINGLE_USE pass at most once across gate scans, reception scans and a reception retry', async () => {
    const singleUse = USAGE_MODEL.SINGLE_USE === 0
    const result = await explore(
      () => [
        gateScan('gateA', SINGLE_USE_UID),
        gateScan('gateB', SINGLE_USE_UID),
        receptionScan({
          name: 'desk',
          readsClock: false,
          replayCheck: true,
          requestId: 'desk-1',
          singleUse,
          uid: SINGLE_USE_UID,
        }),
        receptionScan({
          name: 'deskRetry',
          readsClock: false,
          replayCheck: true,
          requestId: 'desk-1',
          singleUse,
          uid: SINGLE_USE_UID,
        }),
      ],
      1,
      async (world) => {
        const shownAdmit = [...world.shown.values()].filter(Boolean).length
        const rows = await countRows(SINGLE_USE_UID)
        if (shownAdmit > 1) {
          return `${String(shownAdmit)} requests showed ADMIT for one SINGLE_USE pass`
        }
        if (rows.admits > 1 || rows.slots > 1 || (rows.admits === 1) !== (rows.slots === 1)) {
          return `D1 holds ${String(rows.admits)} ADMIT rows and ${String(rows.slots)} slots`
        }
        return null
      },
    )
    expect(result.schedules).toBe(180)
    expect(shown(result.violations)).toStrictEqual([])
  })

  it('awards no more stamps on a day than its limit across two scans, a raised limit and midnight', async () => {
    const result = await explore(
      () => [
        receptionScan({
          name: 'scanA',
          readsClock: true,
          replayCheck: false,
          requestId: 'a',
          singleUse: false,
          uid: MEMBERSHIP_UID,
        }),
        receptionScan({
          name: 'scanB',
          readsClock: true,
          replayCheck: false,
          requestId: 'b',
          singleUse: false,
          uid: MEMBERSHIP_UID,
        }),
        midnight,
        raiseLimit(2),
      ],
      1,
      dailyCapCheck,
    )
    expect(result.schedules).toBe(180)
    // Finding 1 in .agents/skills/verify-admission/SKILL.md: a scan that read the
    // clock before midnight but records after the limit was raised is booked to
    // the old day under the new limit. Every violation must be that pattern; any
    // other is a new bug. When the finding is fixed, the count below drops to 0:
    // delete these lines and expect no violations at all.
    expect(shown(result.violations.filter((found) => !staleDayAfterRaise(found.labels)))).toStrictEqual([])
    expect(result.violations).toHaveLength(STALE_DAY_SCHEDULES)
  })

  it('awards one stamp per request id and replays the same receipt across a retry', async () => {
    const result = await explore(
      () => [
        receptionScan({
          name: 'scanA',
          readsClock: true,
          replayCheck: false,
          requestId: 'a',
          singleUse: false,
          uid: MEMBERSHIP_UID,
        }),
        receptionScan({
          name: 'scanARetry',
          readsClock: true,
          replayCheck: true,
          requestId: 'a',
          singleUse: false,
          uid: MEMBERSHIP_UID,
        }),
        receptionScan({
          name: 'scanB',
          readsClock: true,
          replayCheck: false,
          requestId: 'b',
          singleUse: false,
          uid: MEMBERSHIP_UID,
        }),
      ],
      1,
      async (world) => {
        const capped = await dailyCapCheck(world)
        if (capped !== null) {
          return capped
        }
        const answers = new Set(world.responses.get('a'))
        if (answers.size > 1) {
          return `request a answered differently on retry: ${[...answers].join(' / ')}`
        }
        const rowsForA = await db
          .select()
          .from(receptionRequests)
          .where(eq(receptionRequests.id, `${ISSUER}:a`))
        const entriesForA = await db
          .select()
          .from(entryLog)
          .where(eq(entryLog.receptionId, `${ISSUER}:a`))
        if (rowsForA.length !== 1 || entriesForA.length !== 1) {
          return `request a left ${String(rowsForA.length)} receipts and ${String(entriesForA.length)} entries`
        }
        return null
      },
    )
    expect(result.schedules).toBe(210)
    expect(shown(result.violations)).toStrictEqual([])
  })
})
