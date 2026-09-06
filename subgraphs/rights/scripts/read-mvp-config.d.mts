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
  announcerFromBlock: number
}

export function readMvpGraphConfig(path: string, options?: { environment?: string }): MvpGraphConfig
