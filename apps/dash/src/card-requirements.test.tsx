// @vitest-environment happy-dom
import type { CardView, Hex } from '@fuda/sdk'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { cardBodyFrom, cardUpdateBodyFrom, EMPTY_FORM } from './card-designer.ts'
import { CardDesigner } from './CardDesigner.tsx'
import { CardApplicants, CardRequirements } from './CardRequirements.tsx'
import type { LoadApplicants } from './CardRequirements.tsx'
import { DASH_COPY } from './copy.ts'
import { membershipCard } from './test/management-fixtures.ts'
import { act, buttonNamed, choose, cleanup, flush, mount, tap, typeInto } from './test/render.tsx'

const registry: Hex = `0x${'ab'.repeat(20)}`
const assetId: Hex = `0x${'cd'.repeat(32)}`
const termsId: Hex = `0x${'ef'.repeat(32)}`
const designer = (registries: string[] = []) =>
  mount(
    <CardDesigner
      busy={false}
      copy={DASH_COPY.en.designer}
      failure={null}
      issuer={null}
      requirementRegistries={registries}
      onCheckSlug={async () => await Promise.resolve('available')}
      onEditProfile={vi.fn<() => void>()}
      onSubmit={vi.fn<() => void>()}
    />,
  )

describe('card requirements', () => {
  afterEach(cleanup)

  it('offers the requirement only when the deployment has registries', () => {
    const host = designer()
    expect(host.querySelector('option[value="address"]')).toBeNull()
    expect(host.querySelector('#requirement-enabled')).toBeNull()
    expect(designer([registry]).querySelector('#requirement-enabled')).not.toBeNull()
  })

  it('preselects the only registry, validates fields in place and produces a creation body', async () => {
    const host = designer([registry])
    tap(host.querySelector<HTMLInputElement>('#requirement-enabled')!)
    expect({
      identity: host.querySelector<HTMLSelectElement>('#identity')?.value,
      options: [...host.querySelectorAll('#identity option')].map((option) => option.getAttribute('value')),
      registry: host.querySelector<HTMLSelectElement>('#requirement-registry')?.value,
    }).toStrictEqual({ identity: 'none', options: ['none', 'address'], registry })
    expect(host.textContent).toContain(DASH_COPY.en.designer.identityWalletHint)
    expect(host.querySelector('[role="alert"]')).toBeNull()
    const asset = host.querySelector<HTMLInputElement>('#requirement-assetId')!
    typeInto(asset, '0x1234')
    act(() => {
      asset.dispatchEvent(new Event('blur'))
    })
    await flush()
    expect(host.textContent).toContain(DASH_COPY.en.designer.requirementHexError)
    typeInto(asset, assetId)
    typeInto(host.querySelector<HTMLInputElement>('#requirement-termsId')!, termsId)
    expect(host.querySelector('[aria-invalid="true"]')).toBeNull()
  })

  it.each(['none', 'address'] as const)('creates %s requirements only in creation requests', (identity) => {
    const form = {
      ...EMPTY_FORM,
      identity,
      requirement: { assetId, registry, termsId },
      requirementEnabled: true,
    }
    expect(cardBodyFrom(form)).toMatchObject({
      identity,
      record: 'offchain',
      requirements: [{ assetId, kind: 'erc8432-agreement', registry, termsId }],
    })
    expect(cardBodyFrom({ ...form, requirement: { ...form.requirement, termsId: 'bad' } })).toBeNull()
    const update = cardUpdateBodyFrom(form)
    expect(update).not.toHaveProperty('requirements')
    expect(update).not.toHaveProperty('identity')
  })

  it('clears fields and restores ordinary identities when switched off, then defaults to Wallet again', () => {
    const host = designer([registry])
    const toggle = host.querySelector<HTMLInputElement>('#requirement-enabled')!
    tap(toggle)
    typeInto(host.querySelector<HTMLInputElement>('#requirement-assetId')!, assetId)
    choose(host.querySelector<HTMLSelectElement>('#identity')!, 'address')
    tap(toggle)
    expect(host.querySelector('#requirement-assetId')).toBeNull()
    expect(host.querySelector<HTMLSelectElement>('#identity')?.value).toBe('none')
    expect(
      [...host.querySelectorAll('#identity option')].map((option) => option.getAttribute('value')),
    ).toStrictEqual(['none', 'passkey', 'sensitive'])
    tap(toggle)
    expect(host.querySelector<HTMLInputElement>('#requirement-assetId')?.value).toBe('')
    expect(host.querySelector<HTMLSelectElement>('#identity')?.value).toBe('none')
  })

  it('shows a saved address identity even without registries', () => {
    const host = mount(
      <CardDesigner
        busy={false}
        editing
        copy={DASH_COPY.en.designer}
        failure={null}
        issuer={null}
        initialDraft={{ ...EMPTY_FORM, identity: 'address' }}
        onCheckSlug={async () => await Promise.resolve('available')}
        onEditProfile={vi.fn<() => void>()}
        onSubmit={vi.fn<() => void>()}
      />,
    )
    expect(host.querySelector<HTMLSelectElement>('#identity')?.value).toBe('address')
    expect(host.querySelector<HTMLSelectElement>('#identity')?.disabled).toBe(true)
    expect(host.querySelector('#requirement-assetId')).toBeNull()
  })

  it.each([
    { identity: 'none', locale: 'en' },
    { identity: 'none', locale: 'ja' },
    { identity: 'address', locale: 'en' },
    { identity: 'address', locale: 'ja' },
  ] as const)('shows read-only requirement links for $identity in $locale', ({ locale, identity }) => {
    const card: CardView = {
      ...membershipCard,
      identity,
      requirements: [{ assetId, kind: 'erc8432-agreement', registry, termsId }],
    }
    const host = mount(<CardRequirements card={card} copy={DASH_COPY[locale]} />)
    expect(host.textContent).toContain(
      identity === 'address'
        ? DASH_COPY[locale].designer.identityAddressHint
        : DASH_COPY[locale].designer.identityWalletHint,
    )
    expect(host.textContent).toContain(assetId)
    expect(host.textContent).toContain(termsId)
    expect(host.querySelectorAll('a')).toHaveLength(2)
    expect(host.querySelector('a')?.href).toContain(`/address/${registry}`)
  })

  it('shows an empty applicant list', async () => {
    const load = vi.fn<LoadApplicants>().mockResolvedValue({ body: { applicants: [], next: null }, ok: true })
    const host = mount(<CardApplicants cardId="card" copy={DASH_COPY.en} load={load} />)
    await flush()
    expect(host.textContent).toContain('No one has applied yet.')
    expect(host.textContent).toContain('not verified')
    expect(host.querySelector('button')).toBeNull()
  })

  it('appends the next page in order and copies the chosen address', async () => {
    const address = `0x${'12'.repeat(20)}`
    const nextAddress = `0x${'34'.repeat(20)}`
    const writeText = vi.fn<(value: string) => Promise<void>>().mockImplementation(async () => {
      await Promise.resolve()
    })
    vi.stubGlobal('navigator', { clipboard: { writeText } })
    const load = vi
      .fn<LoadApplicants>()
      .mockResolvedValueOnce({
        body: { applicants: [{ address, appliedAt: 1_780_000_000 }], next: 'cursor' },
        ok: true,
      })
      .mockResolvedValueOnce({
        body: { applicants: [{ address: nextAddress, appliedAt: 1_780_000_100 }], next: null },
        ok: true,
      })
    try {
      const host = mount(<CardApplicants cardId="card" copy={DASH_COPY.en} load={load} />)
      await flush()
      expect(host.querySelector('time')?.dateTime).toBe('2026-05-28T20:26:40.000Z')
      tap(buttonNamed(host, 'Copy address'))
      await flush()
      expect(writeText).toHaveBeenCalledWith(address)
      expect(host.textContent).toContain('Copied')
      tap(buttonNamed(host, 'Load more'))
      await flush()
      expect(load).toHaveBeenLastCalledWith('card', 'cursor')
      expect(
        [...host.querySelectorAll('li')].map((row) => row.querySelector('span')?.textContent),
      ).toStrictEqual([address, nextAddress])
    } finally {
      vi.unstubAllGlobals()
    }
  })
})
