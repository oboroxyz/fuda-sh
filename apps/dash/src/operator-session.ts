import { createTokenStore } from '@fuda/libs/auth'

import { API_BASE_URL } from './config.ts'

const store = createTokenStore({ apiBaseUrl: API_BASE_URL, audience: 'operator' })
export const readOperatorToken = store.read
export const saveOperatorToken = store.save
export const clearOperatorToken = store.clear
