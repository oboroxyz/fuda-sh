import { test } from '@e2e-dev/web'
import { createVenue } from '../support/seed.ts'

const dump = async (browser: any, label: string) => {
  await new Promise((r) => setTimeout(r, 2500))
  console.log(`${label}>> ${await browser.evaluate(() => location.href)}\n`, await browser.evaluate(() => document.body.innerText))
  console.log(`${label} BUTTONS>>`, await browser.evaluate(() => [...document.querySelectorAll('button,a')].map((e) => `${e.tagName}:${(e.textContent ?? '').trim().slice(0,40)}|${e.getAttribute('aria-label')}`).join(' ; ')))
}

test('probe', async ({ app, browser }) => {
  const venue = await createVenue()
  await app.open('/')
  await dump(browser, 'TOP')
  await app.open(`/@${venue.handle}`)
  await dump(browser, 'VENUE')
  await app.open(`/@${venue.handle}/home`)
  await dump(browser, 'HOME')
  await app.open('/@nobody-here')
  await dump(browser, 'UNKNOWN')
})
