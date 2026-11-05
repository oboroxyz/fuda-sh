export interface SchemaVersion {
  uid: `0x${string}`
  version: number
}

export interface MvpGraphConfig {
  schemas: {
    entitlement: SchemaVersion[]
    issuerDelegation: SchemaVersion[]
    attendance: SchemaVersion[]
  }
  startBlock: number
}

export function readMvpGraphConfig(path: string, options?: { target?: string }): MvpGraphConfig
