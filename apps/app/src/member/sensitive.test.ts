import type { MemberSecretCopyView, SelfServeIssueResponse } from '@fuda/sdk'
import { verifyMessage } from 'viem'
import type { Hex } from 'viem'
import { describe, expect, it, vi } from 'vitest'

import { writeTokenFrom, openEntries, sealEntries, wrapSecret } from './member-secret.ts'
import type { Sealed, VaultEntry } from './member-secret.ts'
import {
  addPasskeyKeepingSecret,
  claimSensitive,
  openMemberSecret,
  PASS_NOT_IN_VAULT,
  readVaultEntries,
  signForPass,
} from './sensitive.ts'
import type { PrfAnswer, SensitiveIo } from './sensitive.ts'

const UID: Hex = `0x${'ab'.repeat(32)}`
const OTHER_UID: Hex = `0x${'cd'.repeat(32)}`

const prfOf = (id: string): Uint8Array<ArrayBuffer> => new TextEncoder().encode(id.padEnd(32, '.'))

const answerFrom = (id: string): PrfAnswer => ({ credentialId: id, kind: 'result', output: prfOf(id) })

const memoryStorage = () => {
  const items = new Map<string, string>()
  return {
    getItem: (key: string) => items.get(key) ?? null,
    items,
    key: (index: number) => [...items.keys()][index] ?? null,
    get length() {
      return items.size
    },
    removeItem: (key: string) => {
      items.delete(key)
    },
    setItem: (key: string, value: string) => {
      items.set(key, value)
    },
  }
}

// A small stand-in for the api: it holds only what the real one does, and answers conflicts
// by the same rules.
interface VaultCell {
  current: (Sealed & { version: number }) | null
}

const fakeServer = (passkeys: string[] = ['one']) => {
  const copies: MemberSecretCopyView[] = []
  let writeToken: string | null = null
  const vault: VaultCell = { current: null }
  const outcomes: string[] = []
  const claimed: Hex[] = []
  const storage = memoryStorage()
  const io: SensitiveIo = {
    addCopy: async ({ ciphertext, credentialId, first, iv, writeToken: token }) => {
      if (!first && token !== writeToken) {
        return { error: 'secret_proof_required', network: false, ok: false, status: 403 }
      }
      if (first !== (copies.length === 0)) {
        return await Promise.resolve({ error: 'secret_conflict', network: false, ok: false, status: 409 })
      }
      writeToken = token
      copies.push({ ciphertext, credentialId, iv })
      return await Promise.resolve({ body: { added: true }, ok: true })
    },
    addPasskey: async () => {
      passkeys.push('new')
      return await Promise.resolve({ credentialId: 'new', ok: true, prfOutput: null })
    },
    askPrf: async ({ allow }) => await Promise.resolve(answerFrom(allow[0]?.id ?? 'one')),
    claim: async (_handle, _slug, _source, holderAddress) => {
      claimed.push(holderAddress)
      const body: SelfServeIssueResponse = {
        holder: `0x${'00'.repeat(20)}`,
        level: 'signed',
        memberNumber: 'ABCD',
        passUrls: { apple: '', google: '', web: '' },
        qr: '',
        uid: claimed.length === 1 ? UID : OTHER_UID,
      }
      return await Promise.resolve({ body, ok: true })
    },
    countOutcome: async (outcome) => {
      outcomes.push(outcome)
      await Promise.resolve()
    },
    readSecret: async () =>
      await Promise.resolve({
        body: {
          allowCredentials: passkeys
            .filter((id) => copies.length === 0 || copies.some((copy) => copy.credentialId === id))
            .map((id) => ({ id, transports: [] })),
          copies: [...copies],
          rpId: 'fuda.sh',
        },
        ok: true,
      }),
    readVault: async () => await Promise.resolve({ body: { vault: vault.current }, ok: true }),
    storage: () => storage,
    writeVault: async (sealed, expectedVersion, token) => {
      if (token !== writeToken) {
        return { error: 'secret_proof_required', network: false, ok: false, status: 403 }
      }
      if ((vault.current?.version ?? 0) !== expectedVersion) {
        return await Promise.resolve({ error: 'vault_conflict', network: false, ok: false, status: 409 })
      }
      vault.current = { ...sealed, version: expectedVersion + 1 }
      return await Promise.resolve({ body: { version: expectedVersion + 1 }, ok: true })
    },
  }
  return { claimed, copies, io, outcomes, storage, vault }
}

const failingWrite: SensitiveIo['writeVault'] = async () =>
  await Promise.resolve({ error: 'internal', network: true, ok: false, status: 502 })

const CARD = { cardTitle: 'Staff badge', slug: 'staff', source: null, venue: 'coffee' }

describe('opening the member secret', () => {
  it('starts one with the first passkey that answers, and counts only that', async () => {
    const server = fakeServer()
    const opened = await openMemberSecret(server.io)
    expect(opened.kind).toBe('open')
    expect(server.copies.map((copy) => copy.credentialId)).toStrictEqual(['one'])
    expect(server.outcomes).toStrictEqual(['prf'])
  })

  it('stops at no PRF result, counts it, and stores nothing', async () => {
    const server = fakeServer()
    const opened = await openMemberSecret({
      ...server.io,
      askPrf: async () => await Promise.resolve({ kind: 'none' }),
    })
    expect(opened.kind).toBe('no_prf')
    expect(server.copies).toStrictEqual([])
    expect(server.outcomes).toStrictEqual(['no_prf'])
  })

  it('gets the same secret back on a second opening', async () => {
    const server = fakeServer()
    const first = await openMemberSecret(server.io)
    const second = await openMemberSecret(server.io)
    expect(second).toStrictEqual(first)
    expect(server.copies).toHaveLength(1)
    expect(server.outcomes).toStrictEqual(['prf'])
  })

  it('offers only the passkeys that hold a copy once one exists', async () => {
    const server = fakeServer(['one', 'two'])
    await openMemberSecret(server.io)
    const askPrf = vi.fn<SensitiveIo['askPrf']>(async () => await Promise.resolve(answerFrom('one')))
    await openMemberSecret({ ...server.io, askPrf })
    expect(askPrf).toHaveBeenCalledWith({ allow: [{ id: 'one', transports: [] }], rpId: 'fuda.sh' })
  })

  it('takes the other device’s secret when both enroll at once', async () => {
    const server = fakeServer(['one', 'two'])
    let raced = false
    const addCopy: SensitiveIo['addCopy'] = async (copy) => {
      if (!raced) {
        raced = true
        await server.io.addCopy({
          ...(await wrapSecret(new Uint8Array(32).fill(7), prfOf('one'))),
          credentialId: 'one',
          first: true,
          writeToken: await writeTokenFrom(new Uint8Array(32).fill(7)),
        })
      }
      return await server.io.addCopy(copy)
    }
    const opened = await openMemberSecret({ ...server.io, addCopy })
    expect(opened).toStrictEqual({ kind: 'open', secret: new Uint8Array(32).fill(7) })
  })

  it('says it cannot open a copy when the PRF value has changed, and never writes over it', async () => {
    const server = fakeServer()
    await openMemberSecret(server.io)
    const opened = await openMemberSecret({
      ...server.io,
      askPrf: async () =>
        await Promise.resolve({ credentialId: 'one', kind: 'result', output: prfOf('changed') }),
    })
    expect(opened.kind).toBe('unopenable')
    expect(server.copies).toHaveLength(1)
  })

  it('says the same when a passkey holding a copy returns no result, without counting it', async () => {
    const server = fakeServer()
    await openMemberSecret(server.io)
    const opened = await openMemberSecret({
      ...server.io,
      askPrf: async () => await Promise.resolve({ kind: 'none' }),
    })
    expect(opened.kind).toBe('unopenable')
    expect(server.outcomes).toStrictEqual(['prf'])
  })
})

describe(claimSensitive, () => {
  it('attests a new key for each pass and lists both on the device', async () => {
    const server = fakeServer()
    await expect(claimSensitive(server.io, CARD)).resolves.toMatchObject({ ok: true, saved: true })
    await expect(claimSensitive(server.io, CARD)).resolves.toMatchObject({ ok: true, saved: true })
    expect(new Set(server.claimed).size).toBe(2)
    const opened = await openMemberSecret(server.io)
    const read = opened.kind === 'open' ? await readVaultEntries(server.io, opened.secret) : null
    expect(read).toMatchObject({
      entries: [
        { cardTitle: 'Staff badge', uid: UID, venue: 'coffee' },
        { cardTitle: 'Staff badge', uid: OTHER_UID, venue: 'coffee' },
      ],
      ok: true,
      version: 2,
    })
  })

  it('sends no PRF output and no secret to any route', async () => {
    const server = fakeServer()
    const sent: string[] = []
    const output = prfOf('one')
    await claimSensitive(
      {
        ...server.io,
        addCopy: async (copy) => {
          sent.push(JSON.stringify(copy))
          return await server.io.addCopy(copy)
        },
        writeVault: async (sealed, version, token) => {
          sent.push(JSON.stringify(sealed))
          return await server.io.writeVault(sealed, version, token)
        },
      },
      CARD,
    )
    const hexOutput = [...output].map((byte) => byte.toString(16).padStart(2, '0')).join('')
    expect(sent.join(',')).not.toContain(hexOutput)
    expect(sent.join(',')).not.toContain('one....')
  })

  it('merges with a write from another device instead of dropping it', async () => {
    const server = fakeServer()
    const opened = await openMemberSecret(server.io)
    if (opened.kind !== 'open') {
      throw new Error('expected an open secret')
    }
    const theirs: VaultEntry = { cardTitle: 'Other', salt: 'c2FsdA', uid: OTHER_UID, venue: 'other' }
    let lost = false
    const writeVault: SensitiveIo['writeVault'] = async (sealed, version, token) => {
      if (!lost) {
        lost = true
        await server.io.writeVault(await sealEntries([theirs], opened.secret), version, token)
      }
      return await server.io.writeVault(sealed, version, token)
    }
    await expect(claimSensitive({ ...server.io, writeVault }, CARD)).resolves.toMatchObject({ saved: true })
    await expect(
      openEntries(server.vault.current ?? { ciphertext: '', iv: '' }, opened.secret),
    ).resolves.toMatchObject([{ uid: OTHER_UID }, { uid: UID }])
  })

  it('keeps a pass it could not list, sealed on the device, and lists it next time', async () => {
    const server = fakeServer()
    await expect(claimSensitive({ ...server.io, writeVault: failingWrite }, CARD)).resolves.toMatchObject({
      ok: true,
      saved: false,
    })
    expect(server.vault.current).toBeNull()
    expect([...server.storage.items.values()].join(',')).not.toContain(UID.slice(2))
    const opened = await openMemberSecret(server.io)
    const read = opened.kind === 'open' ? await readVaultEntries(server.io, opened.secret) : null
    expect(read).toMatchObject({ entries: [{ uid: UID }], ok: true, version: 1 })
    expect(server.storage.items.size).toBe(0)
  })

  it('issues nothing, and never overwrites a vault it could not read', async () => {
    const server = fakeServer()
    server.vault.current = {
      ...(await sealEntries([], new Uint8Array(32).fill(9))),
      version: 3,
    }
    const before = server.vault.current
    await expect(claimSensitive(server.io, CARD)).resolves.toStrictEqual({
      failure: 'secret_unopenable',
      ok: false,
    })
    expect(server.vault.current).toBe(before)
    expect(server.claimed).toStrictEqual([])
  })

  it('claims nothing when no passkey answers', async () => {
    const server = fakeServer()
    await expect(
      claimSensitive(
        { ...server.io, askPrf: async () => await Promise.resolve({ kind: 'cancelled' }) },
        CARD,
      ),
    ).resolves.toStrictEqual({ failure: 'passkey_cancelled', ok: false })
    await expect(
      claimSensitive({ ...server.io, askPrf: async () => await Promise.resolve({ kind: 'none' }) }, CARD),
    ).resolves.toStrictEqual({ failure: 'no_prf', ok: false })
    expect(server.claimed).toStrictEqual([])
  })
})

describe(signForPass, () => {
  it('signs with the key the pass attested', async () => {
    const server = fakeServer()
    await claimSensitive(server.io, CARD)
    const message = `fuda-gate:${UID}:0x01`
    const signature = await signForPass(server.io, UID, message)
    await expect(verifyMessage({ address: server.claimed[0] ?? '0x', message, signature })).resolves.toBe(
      true,
    )
  })

  it('does so through a second passkey, as on a new device', async () => {
    const server = fakeServer()
    await claimSensitive(server.io, CARD)
    await expect(addPasskeyKeepingSecret(server.io)).resolves.toStrictEqual({ holdsSecret: true, ok: true })
    const message = `fuda-gate:${UID}:0x02`
    const signature = await signForPass(
      {
        ...server.io,
        askPrf: async () => await Promise.resolve(answerFrom('new')),
      },
      UID,
      message,
    )
    await expect(verifyMessage({ address: server.claimed[0] ?? '0x', message, signature })).resolves.toBe(
      true,
    )
  })

  it('refuses a pass this account does not list', async () => {
    const server = fakeServer()
    await claimSensitive(server.io, CARD)
    await expect(signForPass(server.io, OTHER_UID, 'x')).rejects.toThrow(PASS_NOT_IN_VAULT)
  })
})

describe(addPasskeyKeepingSecret, () => {
  it('adds a plain passkey, with one prompt, while the account holds no secret', async () => {
    const server = fakeServer()
    const askPrf = vi.fn<SensitiveIo['askPrf']>()
    await expect(addPasskeyKeepingSecret({ ...server.io, askPrf })).resolves.toStrictEqual({
      holdsSecret: false,
      ok: true,
    })
    expect(askPrf).not.toHaveBeenCalled()
  })

  it('uses a result the new passkey gave at creation, saving a prompt', async () => {
    const server = fakeServer()
    await openMemberSecret(server.io)
    const askPrf = vi.fn<SensitiveIo['askPrf']>(async () => await Promise.resolve(answerFrom('one')))
    await expect(
      addPasskeyKeepingSecret({
        ...server.io,
        addPasskey: async () =>
          await Promise.resolve({ credentialId: 'new', ok: true, prfOutput: prfOf('new') }),
        askPrf,
      }),
    ).resolves.toStrictEqual({ holdsSecret: true, ok: true })
    expect(askPrf).toHaveBeenCalledOnce()
  })

  it('leaves a new passkey with no PRF for sign-in only', async () => {
    const server = fakeServer()
    await openMemberSecret(server.io)
    const askPrf: SensitiveIo['askPrf'] = async ({ allow }) =>
      await Promise.resolve(allow.some((row) => row.id === 'new') ? { kind: 'none' } : answerFrom('one'))
    await expect(addPasskeyKeepingSecret({ ...server.io, askPrf })).resolves.toStrictEqual({
      holdsSecret: false,
      ok: true,
    })
    expect(server.copies.map((copy) => copy.credentialId)).toStrictEqual(['one'])
  })

  it('adds nothing when the member dismisses the first prompt', async () => {
    const server = fakeServer()
    await openMemberSecret(server.io)
    const addPasskey = vi.fn<SensitiveIo['addPasskey']>()
    await expect(
      addPasskeyKeepingSecret({
        ...server.io,
        addPasskey,
        askPrf: async () => await Promise.resolve({ kind: 'cancelled' }),
      }),
    ).resolves.toStrictEqual({ failure: 'cancelled', ok: false })
    expect(addPasskey).not.toHaveBeenCalled()
  })

  it('still adds a passkey for sign-in where the secret will not open', async () => {
    const server = fakeServer()
    await openMemberSecret(server.io)
    await expect(
      addPasskeyKeepingSecret({
        ...server.io,
        askPrf: async () => await Promise.resolve({ kind: 'none' }),
      }),
    ).resolves.toStrictEqual({ holdsSecret: false, ok: true })
    expect(server.copies.map((copy) => copy.credentialId)).toStrictEqual(['one'])
  })
})

describe('pending recovery concurrency', () => {
  it('recovers both simultaneous claims after failed vault writes', async () => {
    const server = fakeServer()
    const opened = await openMemberSecret(server.io)
    expect(opened.kind).toBe('open')
    const io = { ...server.io, writeVault: failingWrite }
    const results = await Promise.all([claimSensitive(io, CARD), claimSensitive(io, CARD)])
    expect(results).toMatchObject([
      { ok: true, saved: false },
      { ok: true, saved: false },
    ])
    const recovered = opened.kind === 'open' ? await readVaultEntries(server.io, opened.secret) : null
    expect(recovered?.ok).toBe(true)
    expect(recovered && recovered.ok ? recovered.entries.length : 0).toBe(2)
    expect(server.claimed).toHaveLength(2)
  })
})

describe('pending entry lifetime', () => {
  it.each([UID, OTHER_UID])('retains all failed entries when %s is stored first', async (firstStored) => {
    const server = fakeServer()
    await openMemberSecret(server.io)
    const stored = Promise.withResolvers<null>()
    const io: SensitiveIo = {
      ...server.io,
      claim: async (...args) => {
        const issued = await server.io.claim(...args)
        if (issued.ok && issued.body.uid !== firstStored) {
          await stored.promise
        }
        return issued
      },
      storage: () => ({
        ...server.storage,
        setItem: (key, value) => {
          server.storage.setItem(key, value)
          stored.resolve(null)
        },
      }),
      writeVault: failingWrite,
    }
    await Promise.all([claimSensitive(io, CARD), claimSensitive(io, CARD)])
    const opened = await openMemberSecret(server.io)
    if (opened.kind !== 'open') {
      throw new Error('expected an open secret')
    }
    const before = new Map(server.storage.items)
    await expect(
      readVaultEntries({ ...server.io, writeVault: failingWrite }, opened.secret),
    ).resolves.toStrictEqual({ ok: false })
    expect(server.storage.items).toStrictEqual(before)
    const recovered = await readVaultEntries(server.io, opened.secret)
    expect(recovered.ok).toBe(true)
    expect(recovered.ok ? recovered.entries.map((entry) => entry.uid).toSorted() : []).toStrictEqual([
      UID,
      OTHER_UID,
    ])
    expect(server.storage.items.size).toBe(0)
  })

  it('keeps an entry added while an earlier recovery write is in flight', async () => {
    const server = fakeServer()
    await claimSensitive({ ...server.io, writeVault: failingWrite }, CARD)
    const opened = await openMemberSecret(server.io)
    if (opened.kind !== 'open') {
      throw new Error('expected an open secret')
    }
    const writeVault: SensitiveIo['writeVault'] = async (sealed, version, token) => {
      await claimSensitive({ ...server.io, writeVault: failingWrite }, CARD)
      return await server.io.writeVault(sealed, version, token)
    }
    await expect(readVaultEntries({ ...server.io, writeVault }, opened.secret)).resolves.toMatchObject({
      entries: [{ uid: UID }],
      ok: true,
    })
    expect(server.storage.items.size).toBe(1)
    await expect(readVaultEntries(server.io, opened.secret)).resolves.toMatchObject({
      entries: [{ uid: UID }, { uid: OTHER_UID }],
      ok: true,
    })
    expect(server.storage.items.size).toBe(0)
  })
})
