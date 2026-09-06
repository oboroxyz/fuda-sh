import { env } from 'cloudflare:test'
import { recoverAddress } from 'viem'
import type { Address, Hex } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { describe, expect, it } from 'vitest'

import { getDb } from '../db/client.ts'
import { gatewaySignatureHash, resolveGatewayRequest } from './gateway.ts'
import { ensNames } from './schema.ts'

const VECTOR_RESOLVER: Address = '0x1111111111111111111111111111111111111111'
const VECTOR_KEY: Hex = '0x0000000000000000000000000000000000000000000000000000000000000001'
const VECTOR_GATEWAY_SECRET: Hex = '0x2222222222222222222222222222222222222222222222222222222222222222'
const VECTOR_SIGNER: Address = '0x7E5F4552091A69125d5DfCb7b8C2659029395Bdf'
const VECTOR_EXPIRES = 2_000_000_000n
const VECTOR_REQUEST: Hex =
  '0x9061b92300000000000000000000000000000000000000000000000000000000000000400000000000000000000000000000000000000000000000000000000000000080000000000000000000000000000000000000000000000000000000000000001106636f666665650466756461036574680000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000243b3b57de0eadf6d0c642109fe0df14e1ffef24a74fb69b639ff49ca376ad093e4eb2b18000000000000000000000000000000000000000000000000000000000'
const VECTOR_RESULT: Hex = '0x0000000000000000000000001234567890123456789012345678901234567890'
const VECTOR_DIGEST: Hex = '0xe244a357cae2f202e62e2c178dcbfb452cc2102517ac60d3a0737a654c1010be'
const VECTOR_SIGNATURE: Hex =
  '0x77ae7a3fd3d7e6af762a704497b07c28b76cb655ce6d76bd18811bc6b60bf0534a67bfe9b08fe591aee73d6610f1b0ba11cf782bc10cb96b693f5c659af5e6fb1c'
const VECTOR_RESPONSE: Hex =
  '0x0000000000000000000000000000000000000000000000000000000000000060000000000000000000000000000000000000000000000000000000007735940000000000000000000000000000000000000000000000000000000000000000a000000000000000000000000000000000000000000000000000000000000000200000000000000000000000001234567890123456789012345678901234567890000000000000000000000000000000000000000000000000000000000000004177ae7a3fd3d7e6af762a704497b07c28b76cb655ce6d76bd18811bc6b60bf0534a67bfe9b08fe591aee73d6610f1b0ba11cf782bc10cb96b693f5c659af5e6fb1c00000000000000000000000000000000000000000000000000000000000000'

describe('ENS gateway conformance vector', () => {
  it('matches the fixed digest byte order and uint64 expiry width', () => {
    expect(
      gatewaySignatureHash({
        expires: VECTOR_EXPIRES,
        request: VECTOR_REQUEST,
        resolverAddress: VECTOR_RESOLVER,
        result: VECTOR_RESULT,
      }),
    ).toBe(VECTOR_DIGEST)
  })

  it('produces and recovers the fixed raw-hash signature', async () => {
    const signature = await privateKeyToAccount(VECTOR_KEY).sign({ hash: VECTOR_DIGEST })

    expect(signature).toBe(VECTOR_SIGNATURE)
    await expect(recoverAddress({ hash: VECTOR_DIGEST, signature })).resolves.toBe(VECTOR_SIGNER)
  })

  it('emits the fixed callback envelope through the production gateway', async () => {
    const db = getDb({ DB: env.DB })
    await db.insert(ensNames).values({
      createdAt: 1_999_999_000,
      issuerHandle: 'coffee',
      kind: 'issuer',
      name: 'coffee.fuda.eth',
      ownerAddress: '0x3333333333333333333333333333333333333333',
      status: 'offchain',
      targetAddress: '0x1234567890123456789012345678901234567890',
      updatedAt: 1_999_999_000,
    })

    const response = await resolveGatewayRequest(db, {
      data: VECTOR_REQUEST,
      gatewaySecret: VECTOR_GATEWAY_SECRET,
      now: 1_999_999_700,
      parentName: 'fuda.eth',
      resolverAddress: VECTOR_RESOLVER,
      signerPrivateKey: VECTOR_KEY,
    })

    expect(response).toBe(VECTOR_RESPONSE)
  })
})
