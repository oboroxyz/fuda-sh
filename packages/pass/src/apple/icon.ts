import { base64Decode } from '../base64url.ts'

// Wallet refuses a pass without an icon, so one ships with the builder: a
// 29×29 solid rgb(20,20,20) PNG (the pass background), built once offline as
// IHDR + a single deflated IDAT + IEND and embedded here so the runtime needs
// no image encoder and no network fetch.
const ICON_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAB0AAAAdCAIAAADZ8fBYAAAAJElEQVR42mMQoQ1gGDV31NxRc0fNHTV31NxRc0fNHTV3UJkLALsSxR1Gc1LYAAAAAElFTkSuQmCC'

export const iconPng = (): Uint8Array<ArrayBuffer> => base64Decode(ICON_PNG_BASE64)
