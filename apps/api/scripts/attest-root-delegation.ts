// One-time CLI: attests the root IssuerDelegation — the signer delegating
// issuance to itself — and prints ISSUER_ADDRESS / DELEGATION_UID for
// wrangler.jsonc. Runs under tsx (node), not workerd. Needs SIGNER_PRIVATE_KEY
// and optionally BASE_RPC_URL. Idempotence is the operator's: run it once per
// deployment; a second run mints a second, equally valid delegation.
import { createPublicClient, createWalletClient, http, isHex, parseEventLogs } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { baseSepolia } from 'viem/chains'

import { ZERO_UID } from '../src/chain/client.ts'
import { EAS_ABI } from '../src/eas/abi.ts'
import { encodeDelegationV1 } from '../src/eas/codecs.ts'
import { newest, parseSchemaSets, SCHEMA_STRINGS, schemaUid } from '../src/eas/schemas.ts'

const EAS = '0x4200000000000000000000000000000000000021'

const key = process.env.SIGNER_PRIVATE_KEY
if (key === undefined || !isHex(key)) {
  throw new Error('SIGNER_PRIVATE_KEY (0x-hex) is required')
}

// The schema this delegation is attested under: the newest issuerDelegation uid
// in EAS_SCHEMAS when the operator exports the binding, and otherwise the
// deterministic uid of the current schema string (what register-schemas just
// registered — the two agree unless the schema was versioned).
const schemasJson = process.env.EAS_SCHEMAS
const fromBinding =
  schemasJson === undefined || schemasJson === ''
    ? null
    : newest(parseSchemaSets(schemasJson).issuerDelegation)
const schema = fromBinding?.uid ?? schemaUid(SCHEMA_STRINGS.issuerDelegation)

const existing = process.env.DELEGATION_UID
if (existing !== undefined && existing !== '' && existing !== ZERO_UID) {
  // oxlint-disable-next-line no-console -- a one-time CLI warning; the operator is the only reader
  console.warn(
    `warning: DELEGATION_UID is already set to ${existing}. This run attests a second root delegation; keep whichever uid wrangler.jsonc ends up naming.`,
  )
}

const transport = http(process.env.BASE_RPC_URL ?? 'https://sepolia.base.org')
const account = privateKeyToAccount(key)
const pub = createPublicClient({ chain: baseSepolia, transport })
const wallet = createWalletClient({ account, chain: baseSepolia, transport })

const txHash = await wallet.writeContract({
  abi: EAS_ABI,
  address: EAS,
  args: [
    {
      data: {
        data: encodeDelegationV1({ active: true, issuer: account.address, name: 'fuda root' }),
        expirationTime: 0n,
        recipient: account.address,
        refUID: ZERO_UID,
        revocable: true,
        value: 0n,
      },
      schema,
    },
  ],
  functionName: 'attest',
})
const receipt = await pub.waitForTransactionReceipt({ hash: txHash })
if (receipt.status !== 'success') {
  throw new Error(`attest reverted in ${txHash}`)
}
const [log] = parseEventLogs({ abi: EAS_ABI, eventName: 'Attested', logs: receipt.logs })
if (log === undefined) {
  throw new Error(`no Attested event in ${txHash}`)
}

// oxlint-disable-next-line no-console -- a one-time CLI printing the values the operator pastes into wrangler.jsonc
console.log(
  [
    `tx ${txHash}`,
    `schema ${schema}`,
    '',
    'Paste into wrangler.jsonc vars:',
    `ISSUER_ADDRESS=${account.address}`,
    `DELEGATION_UID=${log.args.uid}`,
  ].join('\n'),
)
