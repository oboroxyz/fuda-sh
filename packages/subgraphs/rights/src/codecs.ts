import { Address, BigInt, Bytes, ethereum } from '@graphprotocol/graph-ts'

export class EntitlementData {
  constructor(
    public holder: Address,
    public issuer: Address,
    public usageModel: i32,
    public tier: i32,
    public level: i32,
    public serial: Bytes,
    public validFrom: BigInt,
    public validUntil: BigInt,
    public metaURI: string,
  ) {}
}

export class DelegationData {
  constructor(
    public issuer: Address,
    public active: boolean,
    public name: string,
  ) {}
}

export class AttendanceData {
  constructor(
    public rightUID: Bytes,
    public holder: Address,
    public enteredAt: BigInt,
    public slotId: Bytes,
  ) {}
}

// EAS/API data is a flat ABI parameter list. Graph's decoder reads one value,
// so a tuple containing a dynamic string needs its outer 32-byte offset added.
const dynamicTuple = (data: Bytes): Bytes =>
  Bytes.fromHexString('0x0000000000000000000000000000000000000000000000000000000000000020').concat(data)

export function decodeEntitlementV1(data: Bytes): EntitlementData | null {
  const decoded = ethereum.decode('(address,address,uint8,uint8,uint8,bytes32,uint64,uint64,string)', dynamicTuple(data))
  if (decoded === null) return null
  const values = decoded.toTuple()
  return new EntitlementData(
    values[0].toAddress(),
    values[1].toAddress(),
    values[2].toI32(),
    values[3].toI32(),
    values[4].toI32(),
    values[5].toBytes(),
    values[6].toBigInt(),
    values[7].toBigInt(),
    values[8].toString(),
  )
}

export function decodeDelegationV1(data: Bytes): DelegationData | null {
  const decoded = ethereum.decode('(address,bool,string)', dynamicTuple(data))
  if (decoded === null) return null
  const values = decoded.toTuple()
  return new DelegationData(values[0].toAddress(), values[1].toBoolean(), values[2].toString())
}

export function decodeAttendanceV1(data: Bytes): AttendanceData | null {
  const decoded = ethereum.decode('(bytes32,address,uint64,bytes32)', data)
  if (decoded === null) return null
  const values = decoded.toTuple()
  return new AttendanceData(
    values[0].toBytes(),
    values[1].toAddress(),
    values[2].toBigInt(),
    values[3].toBytes(),
  )
}
