import { test } from '@e2e-dev/web'
import type { Browser } from '@e2e-dev/web'
import { expect } from 'e2e'
import type { Screen } from 'e2e'

import { SURFACES } from '../../stack.config.ts'
import { claimCard, operatorWithTwoProfiles, readProfile, signInOperator } from '../support/operator.ts'

const switchProfile = async (screen: Screen, current: string, handle: string): Promise<void> => {
  await screen.getByRole('button', current, { exact: true }).tap()
  await screen.getByRole('button', new RegExp(`@${handle}`, 'u')).tap()
}

// The web fixture has one active tab. Use its evaluate escape hatch only for
// this named, same-origin second tab; the stale form is still driven by screen.
const clickInOtherTab = async (browser: Browser, label: string): Promise<void> => {
  await expect
    .poll(
      async () =>
        await browser.evaluate((text) => {
          const tab = window.open('', 'fuda-profile-switch')
          const button = [...(tab?.document.querySelectorAll('button') ?? [])].find(
            (item) => item.textContent?.includes(text) && !item.disabled,
          )
          if (button === undefined) {
            return false
          }
          button.click()
          return true
        }, label),
    )
    .toBe(true)
}

test(
  'switching profiles resets the card draft and the previous store counts',
  { timeout: 90_000 },
  async ({ browser, screen }) => {
    const { first, second } = await operatorWithTwoProfiles()
    await claimCard(first)
    await signInOperator(browser, first.token)
    await browser.goto(`${SURFACES.dash.origin}/cards`, { waitUntil: 'networkidle' })
    const firstRow = screen.getByRole('row').filter({ hasText: first.card.title })
    await expect(firstRow.getByRole('cell').nth(0)).toHaveText('1')
    await expect(firstRow.getByRole('cell').nth(1)).toHaveText('1')
    await expect(
      browser.locator('dl > div').filter({ hasText: 'Total stamps' }).getByText('1', { exact: true }),
    ).toHaveText('1')
    await screen.getByRole('link', '+ Add card', { exact: true }).tap()
    await screen.getByLabel('Card title', { exact: true }).fill('Unsent Coffee draft')
    // Leaving for Profile is the supported way to retain a draft within a session.
    await screen.getByRole('link', 'Profile', { exact: true }).first().tap()
    await expect(screen.getByRole('heading', 'Profile', { exact: true })).toBeVisible()
    await switchProfile(screen, first.issuer.name, second.issuer.handle)
    await expect(screen.getByRole('button', second.issuer.name, { exact: true })).toBeVisible()
    const secondRow = screen.getByRole('row').filter({ hasText: second.card.title })
    await expect(secondRow.getByRole('cell').nth(0)).toHaveText('0')
    await expect(secondRow.getByRole('cell').nth(1)).toHaveText('0')
    await expect(
      browser.locator('dl > div').filter({ hasText: 'Total stamps' }).getByText('0', { exact: true }),
    ).toHaveText('0')
    await secondRow.getByRole('link', 'Edit', { exact: true }).tap()
    await screen.getByLabel('Card title', { exact: true }).fill('Saved Tea card')
    await screen.getByRole('button', 'Save card', { exact: true }).tap()
    await expect(screen.getByText('Card saved.', { exact: true })).toBeVisible()
    await browser.goto(`${SURFACES.dash.origin}/cards/new`, { waitUntil: 'networkidle' })
    await expect(screen.getByLabel('Card title', { exact: true })).toHaveValue('Membership')
  },
)

test(
  'switching in a second tab cannot save the first store form into the second store',
  { timeout: 90_000 },
  async ({ browser, screen }) => {
    const { first, second } = await operatorWithTwoProfiles()
    await signInOperator(browser, first.token)
    const rendered = await fetch(`${SURFACES.dash.origin}/profile`, {
      headers: { cookie: `fuda_operator=${first.token}; fuda_locale=en` },
    })
    expect(rendered.status).toBe(200)
    expect(await rendered.text()).toContain(first.issuer.name)
    await browser.goto(`${SURFACES.dash.origin}/profile`, { waitUntil: 'networkidle' })
    await expect(screen.getByLabel('Name', { exact: true })).toHaveValue(first.issuer.name)
    await screen.getByLabel('Name', { exact: true }).fill('Old tab must not overwrite Tea')
    await browser.evaluate(() => {
      if (window.open('/profile', 'fuda-profile-switch') === null) {
        throw new Error('Second tab did not open')
      }
      return null
    })
    try {
      await expect
        .poll(
          async () =>
            await browser.evaluate((handle) => {
              const tab = window.open('', 'fuda-profile-switch')
              return [...(tab?.document.querySelectorAll('button') ?? [])].some((button) =>
                button.textContent?.includes(`@${handle}`),
              )
            }, second.issuer.handle),
        )
        .toBe(true)
      await clickInOtherTab(browser, first.issuer.name)
      await clickInOtherTab(browser, `@${second.issuer.handle}`)
      await expect
        .poll(
          async () =>
            await browser.evaluate(() => {
              const tab = window.open('', 'fuda-profile-switch')
              return (
                tab?.document.body.textContent?.includes('E2E Tea') === true &&
                tab.location.pathname === '/cards'
              )
            }),
        )
        .toBe(true)
      // The first tab has not navigated or refreshed: it still contains the stale form.
      await expect(screen.getByLabel('Name', { exact: true })).toHaveValue('Old tab must not overwrite Tea')
      await screen.getByRole('button', 'Save', { exact: true }).tap()
      await expect(screen.getByLabel('Name', { exact: true })).toHaveValue(second.issuer.name)
      const firstAfter = await readProfile(first.token)
      const secondAfter = await readProfile(second.token)
      expect(firstAfter.issuer.name).toBe(first.issuer.name)
      expect(secondAfter.issuer.name).toBe(second.issuer.name)
    } finally {
      await browser.evaluate(() => {
        window.open('', 'fuda-profile-switch')?.close()
        return null
      })
    }
  },
)
