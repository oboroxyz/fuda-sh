import { cors } from 'hono/cors'

const PROD_ORIGINS = new Set(['https://app.fuda.sh', 'https://dash.fuda.sh', 'https://gate.fuda.sh'])
const DEV_ORIGIN = /^http:\/\/(?<host>localhost|127\.0\.0\.1):\d+$/u

export const corsPolicy = () =>
  cors({
    allowHeaders: ['Authorization', 'Content-Type'],
    allowMethods: ['GET', 'POST', 'OPTIONS'],
    origin: (origin) => (PROD_ORIGINS.has(origin) || DEV_ORIGIN.test(origin) ? origin : ''),
  })
