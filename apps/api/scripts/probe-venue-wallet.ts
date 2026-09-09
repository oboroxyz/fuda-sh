// Read-only integration probe: two throwaway owners, one issuer wallet.
// ERC-6492 may simulate factory deployment inside eth_call, but no transaction
// is sent. This does not add owners to an existing wallet or create a session.
import assert, { AssertionError } from 'node:assert/strict'

import { createPublicClient, http, parseErc6492Signature, serializeErc6492Signature, zeroAddress } from 'viem'
import { toCoinbaseSmartAccount } from 'viem/account-abstraction'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import { baseSepolia } from 'viem/chains'

import { signInMessage } from '../src/auth/sign-in.ts'
import { createViemChain, DEFAULT_RPC } from '../src/chain/viem-chain.ts'
import { observeProbeRpc } from './probe-rpc.ts'

const probe = async (): Promise<void> => {
  const rpcUrl = process.env.BASE_RPC_URL ?? DEFAULT_RPC
  const rpc = observeProbeRpc(http(rpcUrl, { retryCount: 0, timeout: 15_000 }))
  const client = createPublicClient({ chain: baseSepolia, transport: rpc.transport })
  assert.equal(await client.getChainId(), baseSepolia.id, 'RPC must be Base Sepolia (84532).')

  // These keys are generated for this run and never printed, persisted or funded.
  const owners = [privateKeyToAccount(generatePrivateKey()), privateKeyToAccount(generatePrivateKey())]
  const nonce = BigInt(generatePrivateKey())
  const [first, second] = await Promise.all([
    toCoinbaseSmartAccount({ client, nonce, ownerIndex: 0, owners, version: '1' }),
    toCoinbaseSmartAccount({ client, nonce, ownerIndex: 1, owners, version: '1' }),
  ])
  assert.equal(first.address, second.address, 'Changing the signer must preserve the issuer wallet.')
  assert.equal(
    await client.getCode({ address: first.address }),
    undefined,
    'Probe wallet must be undeployed.',
  )

  // Only verifyMessage is used. The EAS/announcer addresses are never queried;
  // no signer binding is supplied, so ChainClient cannot send transactions.
  const chain = createViemChain(
    {
      ANNOUNCER_ADDRESS: zeroAddress,
      BASE_RPC_URL: rpcUrl,
      EAS_ADDRESS: zeroAddress,
      FACTORY_ADDRESS: first.factory.address,
    },
    rpc.transport,
  )
  const message = signInMessage('operator', generatePrivateKey())
  const [firstSignature, secondSignature] = await Promise.all([
    first.signMessage({ message }),
    second.signMessage({ message }),
  ])
  const [firstValid, secondValid] = await Promise.all([
    chain.verifyMessage({ address: first.address, message, signature: firstSignature }),
    chain.verifyMessage({ address: first.address, message, signature: secondSignature }),
  ])
  assert.equal(firstValid, true, 'First owner signature must verify against the issuer wallet.')
  assert.equal(secondValid, true, 'Second owner signature must verify against the same issuer wallet.')

  const alteredMessageValid = await chain.verifyMessage({
    address: first.address,
    message: signInMessage('operator', generatePrivateKey()),
    signature: secondSignature,
  })
  assert.equal(alteredMessageValid, false, 'A signature must not authorize a different challenge.')

  // Sign for the same wallet using an unregistered credential, but retain the
  // legitimate factory payload. A different factory payload would merely test
  // a different account address, rather than the wallet's owner check.
  const outsider = privateKeyToAccount(generatePrivateKey())
  const unregistered = await toCoinbaseSmartAccount({
    address: first.address,
    client,
    owners: [outsider],
    version: '1',
  })
  const original = parseErc6492Signature(firstSignature)
  assert.ok(original.address !== undefined && original.data !== undefined, 'Expected an ERC-6492 proof.')
  const forged = parseErc6492Signature(await unregistered.signMessage({ message }))
  const outsiderValid = await chain.verifyMessage({
    address: first.address,
    message,
    signature: serializeErc6492Signature({
      address: original.address,
      data: original.data,
      signature: forged.signature,
    }),
  })
  assert.equal(outsiderValid, false, 'An unregistered owner must not authorize the issuer wallet.')

  // A staff wallet's ordinary personal signature is not a proof by the issuer
  // wallet, even when that staff wallet is one of its registered owners.
  const rawOwnerSignature = await owners[0].signMessage({ message })
  assert.equal(
    await chain.verifyMessage({ address: first.address, message, signature: rawOwnerSignature }),
    false,
    'An unwrapped owner signature must not stand in for an issuer-wallet proof.',
  )
  assert.equal(
    await client.getCode({ address: first.address }),
    undefined,
    'Probe must not deploy the wallet.',
  )

  rpc.assertSucceeded()

  // oxlint-disable-next-line no-console -- CLI result contains public addresses and verification outcomes only
  console.log(
    JSON.stringify(
      {
        chainId: baseSepolia.id,
        checks: {
          changedChallengeRejected: true,
          firstOwnerAccepted: true,
          rawOwnerSignatureRejected: true,
          secondOwnerAccepted: true,
          unregisteredOwnerRejected: true,
          walletStillUndeployed: true,
        },
        factory: first.factory.address,
        issuerWallet: first.address,
        owners: owners.map((owner) => owner.address),
      },
      null,
      2,
    ),
  )
}

try {
  await probe()
} catch (error) {
  // RPC errors may contain an API key in their URL: print only our own assertions.
  // oxlint-disable-next-line no-console -- CLI failure must not expose RPC URLs, credentials or signature payloads
  console.error(
    error instanceof AssertionError
      ? error.message
      : 'Venue wallet probe failed. Check Base Sepolia RPC connectivity and the installed smart-wallet SDK.',
  )
  process.exitCode = 1
}
