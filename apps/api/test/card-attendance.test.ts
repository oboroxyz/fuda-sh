import type { Hex, OperatorCardView } from '@fuda/sdk'
import { createExecutionContext, env } from 'cloudflare:test'
import { beforeEach, describe, expect, it } from 'vitest'

import { attendanceHook } from '../src/attendance/attendance-hook.ts'
import { getDb } from '../src/db/client.ts'
import { cards, entryLog, issuers, members, sessions, slots } from '../src/db/schema.ts'
import { parseSchemaSets } from '../src/eas/schemas.ts'
import { appWith, fakeChain } from './env.ts'
import { ATT, configuredEnv, NOW, seedRight, seedRoot } from './fixtures.ts'
import { CARD_INPUT, postJson, signIn } from './operator.ts'

const db = () => getDb({ DB: env.DB })

const chain = fakeChain()
const del = seedRoot(chain)
const bindings = configuredEnv(del, { ENS_PARENT_NAME: 'fuda.eth' })
const app = () => appWith({ chain, now: () => NOW })

const executionCtx = (kept: Promise<unknown>[]): ExecutionContext => {
  const ctx = createExecutionContext()
  ctx.waitUntil = (p: Promise<unknown>) => {
    kept.push(p)
  }
  return ctx
}

const scan = async (uid: Hex): Promise<void> => {
  const kept: Promise<unknown>[] = []
  const scanner = appWith({
    chain,
    now: () => NOW,
    onAdmit: attendanceHook({ chain, db: db(), sets: parseSchemaSets(bindings.EAS_SCHEMAS) }),
  })
  const res = await scanner.request(
    '/v1/verify',
    {
      body: JSON.stringify({ qr: `fuda:v1:${uid}` }),
      headers: { 'content-type': 'application/json' },
      method: 'POST',
    },
    bindings,
    executionCtx(kept),
  )
  expect(res.status).toBe(200)
  await Promise.all(kept)
}

const attendances = (uid: Hex) =>
  [...chain.attestations.values()].filter((a) => a.schema === ATT && a.refUID === uid)

let serial = 0

// A right the way card issuance leaves it: a chain attestation and a members row
// that names its card. Passing null for the card is what admin issuance does.
const rightFor = async (cardId: string | null): Promise<Hex> => {
  serial += 1
  const uid = seedRight(chain, del, { tier: serial })
  await db()
    .insert(members)
    .values({
      attestationUid: uid,
      cardId,
      createdAt: NOW,
      holder: null,
      level: 'bearer',
      memberId: `m${serial}`,
      status: 'active',
      usageModel: 1,
    })
  return uid
}

const createCard = async (
  token: string,
  card: { category: 'membership' | 'ticket'; record: 'offchain' | 'onchain'; attendance?: boolean },
  slug: string,
): Promise<Response> =>
  await postJson(
    app(),
    bindings,
    '/v1/issuers/cards',
    { ...CARD_INPUT.card, description: '', slug, title: slug, validityDays: null, ...card },
    token,
  )

interface Edit {
  attendance?: boolean
}

const put = async (token: string, id: string, body: EditRequest): Promise<Response> =>
  await app().request(
    `/v1/issuers/me/cards/${id}`,
    {
      body: JSON.stringify(body),
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      method: 'PUT',
    },
    bindings,
  )

interface EditRequest extends Edit {
  category: string
  title: string
  [field: string]: string | number | boolean | null | undefined
}

const editBody = (card: OperatorCardView, extra: Edit = {}): EditRequest => ({
  category: card.category,
  claimFrom: null,
  claimUntil: null,
  description: '',
  lockScreen: false,
  title: card.title,
  validFrom: null,
  validUntil: null,
  validityDays: null,
  ...extra,
})

const cardIdOf = async (res: Response): Promise<string> => {
  expect(res.status).toBe(201)
  const { card } = await res.json<{ card: { id: string } }>()
  return card.id
}

const attendanceOf = async (res: Response): Promise<boolean> => {
  const { card } = await res.json<{ card: OperatorCardView }>()
  return card.attendance
}

const storedAttendance = async (id: string): Promise<number | undefined> => {
  const rows = await db().select().from(cards)
  return rows.find((r) => r.id === id)?.attendance
}

describe('Attendance per card', () => {
  let token = ''

  beforeEach(async () => {
    const database = db()
    await database.delete(entryLog)
    await database.delete(slots)
    await database.delete(members)
    await database.delete(cards)
    await database.delete(sessions)
    await database.delete(issuers)
    for (const [uid, a] of chain.attestations) {
      if (a.schema === ATT) {
        chain.attestations.delete(uid)
      }
    }
    ;({ token } = await signIn(app(), bindings))
    await postJson(app(), bindings, '/v1/issuers', CARD_INPUT, token)
  })

  it('starts on for an on-chain ticket and off for an on-chain membership', async () => {
    const ticket = await cardIdOf(await createCard(token, { category: 'ticket', record: 'onchain' }, 'gig'))
    const membership = await cardIdOf(
      await createCard(token, { category: 'membership', record: 'onchain' }, 'club'),
    )
    await expect(storedAttendance(ticket)).resolves.toBe(1)
    await expect(storedAttendance(membership)).resolves.toBe(0)
  })

  it('takes the value the request sets over the category default', async () => {
    const quiet = await cardIdOf(
      await createCard(token, { attendance: false, category: 'ticket', record: 'onchain' }, 'quiet'),
    )
    const loud = await cardIdOf(
      await createCard(token, { attendance: true, category: 'membership', record: 'onchain' }, 'loud'),
    )
    await expect(storedAttendance(quiet)).resolves.toBe(0)
    await expect(storedAttendance(loud)).resolves.toBe(1)
  })

  it('refuses the setting on an off-chain card and stores none', async () => {
    const res = await createCard(token, { attendance: true, category: 'ticket', record: 'offchain' }, 'off')
    expect(res.status).toBe(400)
    const plain = await cardIdOf(await createCard(token, { category: 'ticket', record: 'offchain' }, 'plain'))
    await expect(storedAttendance(plain)).resolves.toBe(0)
  })

  it('writes an Attendance when an on-chain ticket is scanned', async () => {
    const id = await cardIdOf(await createCard(token, { category: 'ticket', record: 'onchain' }, 'gig'))
    const uid = await rightFor(id)
    await scan(uid)
    expect(attendances(uid)).toHaveLength(1)
  })

  it('writes none when an on-chain membership is scanned', async () => {
    const id = await cardIdOf(await createCard(token, { category: 'membership', record: 'onchain' }, 'club'))
    const uid = await rightFor(id)
    await scan(uid)
    expect(attendances(uid)).toHaveLength(0)
    const [row] = await db().select().from(entryLog)
    expect(row).toMatchObject({ attendanceUid: null, decision: 'ADMIT' })
  })

  it('keeps writing one for a right with no card', async () => {
    const uid = await rightFor(null)
    await scan(uid)
    expect(attendances(uid)).toHaveLength(1)
  })

  it('applies an edit on the next scan', async () => {
    const id = await cardIdOf(await createCard(token, { category: 'membership', record: 'onchain' }, 'club'))
    const uid = await rightFor(id)
    await scan(uid)
    expect(attendances(uid)).toHaveLength(0)

    const card = { category: 'membership', title: 'club' } as OperatorCardView
    const on = await put(token, id, editBody({ ...card, title: 'club' }, { attendance: true }))
    expect(on.status).toBe(200)
    await expect(attendanceOf(on)).resolves.toBe(true)
    await scan(uid)
    expect(attendances(uid)).toHaveLength(1)

    await put(token, id, editBody({ ...card, title: 'club' }, { attendance: false }))
    await scan(uid)
    expect(attendances(uid)).toHaveLength(1)
  })

  it('keeps the stored value when an edit leaves it out, and refuses it on an off-chain card', async () => {
    const id = await cardIdOf(await createCard(token, { category: 'ticket', record: 'onchain' }, 'gig'))
    const card = { category: 'ticket', title: 'gig' } as OperatorCardView
    const kept = await put(token, id, editBody(card))
    await expect(attendanceOf(kept)).resolves.toBe(true)

    const offchain = await cardIdOf(
      await createCard(token, { category: 'ticket', record: 'offchain' }, 'plain'),
    )
    const refused = await put(token, offchain, editBody(card, { attendance: true }))
    expect(refused.status).toBe(400)
    const plain = await put(token, offchain, editBody(card))
    await expect(attendanceOf(plain)).resolves.toBe(false)
  })
})
