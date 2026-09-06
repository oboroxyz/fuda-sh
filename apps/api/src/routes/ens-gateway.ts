import { Hono } from 'hono'
import type { Context } from 'hono'
import type { ContentfulStatusCode } from 'hono/utils/http-status'
import * as v from 'valibot'
import { getAddress, isAddress, isAddressEqual, isHex } from 'viem'
import type { Address, Hex } from 'viem'

import { EnsGatewayError, resolveGatewayRequest } from '../ens/gateway.ts'
import { normalizeParentName } from '../ens/names.ts'
import type { AppEnv, Bindings } from '../env.ts'
import { DEFAULT_BUDGET, rateLimit } from '../middleware/rate-limit.ts'

const GatewayBody = v.object({ data: v.string(), sender: v.string() })

interface GatewayConfig {
  allocationSecret: string
  parentName: string
  resolverAddresses: Address[]
  signerPrivateKey: string
}

const configuredValue = (value: string | undefined): string | null =>
  value === undefined || value.trim() === '' ? null : value.trim()

const gatewayConfig = (env: Bindings): GatewayConfig | null => {
  const allocationSecret = configuredValue(env.ENS_GATEWAY_SECRET)
  const signerPrivateKey = configuredValue(env.ENS_GATEWAY_SIGNER_KEY)
  const rawParentName = configuredValue(env.ENS_PARENT_NAME)
  const rawResolverAddresses = configuredValue(env.ENS_RESOLVER_ADDRESSES)
  if (
    allocationSecret === null ||
    signerPrivateKey === null ||
    rawParentName === null ||
    rawResolverAddresses === null
  ) {
    return null
  }
  const resolverAddresses: Address[] = []
  for (const raw of rawResolverAddresses.split(',')) {
    const address = raw.trim()
    if (!isAddress(address, { strict: true })) {
      return null
    }
    resolverAddresses.push(getAddress(address))
  }
  if (resolverAddresses.length === 0) {
    return null
  }
  try {
    return {
      allocationSecret,
      parentName: normalizeParentName(rawParentName),
      resolverAddresses,
      signerPrivateKey,
    }
  } catch {
    return null
  }
}

const messageResponse = (c: Context<AppEnv>, message: string, status: ContentfulStatusCode): Response => {
  c.header('cache-control', 'no-store')
  return c.json({ message }, status)
}

const dataResponse = (c: Context<AppEnv>, data: Hex): Response => {
  c.header('cache-control', 'no-store')
  return c.json({ data }, 200)
}

export const ensGatewayRoutes = new Hono<AppEnv>()

ensGatewayRoutes.post(
  '/ens/gateway',
  rateLimit({ budget: DEFAULT_BUDGET, response: 'eip3668' }),
  async (c) => {
    const config = gatewayConfig(c.env)
    if (config === null) {
      return messageResponse(c, 'Gateway is not configured.', 503)
    }
    const body: unknown = await c.req.json().catch(() => null)
    const parsed = v.safeParse(GatewayBody, body)
    if (!parsed.success) {
      return messageResponse(c, 'Invalid gateway request.', 400)
    }
    const { data: requestData, sender } = parsed.output
    if (!isAddress(sender, { strict: true }) || !isHex(requestData, { strict: true })) {
      return messageResponse(c, 'Invalid gateway request.', 400)
    }
    const resolverAddress = config.resolverAddresses.find((address) => isAddressEqual(address, sender))
    if (resolverAddress === undefined) {
      return messageResponse(c, 'Gateway address not supported.', 404)
    }
    try {
      const responseData = await resolveGatewayRequest(c.get('db'), {
        data: requestData,
        gatewaySecret: config.allocationSecret,
        now: c.get('now')(),
        parentName: config.parentName,
        resolverAddress,
        signerPrivateKey: config.signerPrivateKey,
      })
      return responseData === null
        ? messageResponse(c, 'ENS name or record not found.', 404)
        : dataResponse(c, responseData)
    } catch (error) {
      if (error instanceof EnsGatewayError) {
        return messageResponse(
          c,
          error.kind === 'config' ? 'Gateway is not configured.' : error.message,
          error.kind === 'config' ? 503 : 400,
        )
      }
      throw error
    }
  },
)
