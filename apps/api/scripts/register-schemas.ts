// One-time CLI: idempotently registers the three fuda schemas on the EAS
// SchemaRegistry and prints the UIDs for wrangler.jsonc. Runs under tsx (node),
// not workerd. Needs SIGNER_PRIVATE_KEY and optionally BASE_RPC_URL.
import { createPublicClient, createWalletClient, http, isHex, zeroAddress } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { baseSepolia } from 'viem/chains'

import { SCHEMA_REGISTRY_ABI } from '../src/eas/abi.ts'
import { SCHEMA_STRINGS, schemaUid } from '../src/eas/schemas.ts'

const REGISTRY = '0x4200000000000000000000000000000000000020'

const key = process.env.SIGNER_PRIVATE_KEY
if (key === undefined || !isHex(key)) {
  throw new Error('SIGNER_PRIVATE_KEY (0x-hex) is required')
}

const transport = http(process.env.BASE_RPC_URL ?? 'https://sepolia.base.org')
const account = privateKeyToAccount(key)
const pub = createPublicClient({ chain: baseSepolia, transport })
const wallet = createWalletClient({ account, chain: baseSepolia, transport })

const out: Record<string, { uid: string; version: number }[]> = {}
for (const [kind, schema] of Object.entries(SCHEMA_STRINGS)) {
  const uid = schemaUid(schema)
  // oxlint-disable-next-line no-await-in-loop -- one registration at a time keeps the signer nonce sequential
  const existing = await pub.readContract({
    abi: SCHEMA_REGISTRY_ABI,
    address: REGISTRY,
    args: [uid],
    functionName: 'getSchema',
  })
  if (existing.uid === uid) {
    console.log(`${kind}: already registered ${uid}`)
  } else {
    // oxlint-disable-next-line no-await-in-loop -- see above
    const hash = await wallet.writeContract({
      abi: SCHEMA_REGISTRY_ABI,
      address: REGISTRY,
      args: [schema, zeroAddress, true],
      functionName: 'register',
    })
    // oxlint-disable-next-line no-await-in-loop -- see above
    await pub.waitForTransactionReceipt({ hash })
    console.log(`${kind}: registered ${uid} in ${hash}`)
  }
  out[kind] = [{ uid, version: 1 }]
}

console.log('\nPaste into wrangler.jsonc vars.EAS_SCHEMAS:')
console.log(JSON.stringify(JSON.stringify(out)))
