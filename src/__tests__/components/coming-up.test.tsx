// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import { plan } from '../_setup/factories'
import type { Occurrence } from '@/lib/model/plans'
import { ComingUp } from '@/components/month/ComingUp'

afterEach(cleanup)

const due = (name: string, date: string, amount: number): Occurrence => ({
  plan: plan({ name, amount }),
  due: date,
  paidBy: null,
})

describe('ComingUp', () => {
  it('groups due dates by how near they are, each with its total', () => {
    render(
      <ComingUp
        today="2026-11-16"
        items={[
          due('New Tires', '2026-11-07', 100_000),
          due('Google One', '2026-11-18', 9_900),
          due('iCloud+', '2026-11-21', 1_000),
          due('House Cleaning', '2026-11-28', 28_000),
          due('Youtube Premium', '2026-11-30', 1_600),
          due('Tithe', '2026-12-02', 20_200),
        ]}
      />,
    )
    const groups = screen.getAllByRole('region').map((g) => g.ariaLabel)
    expect(groups).toEqual([
      'Late',
      'This week',
      'Next week',
      'Later this month',
      'After this month',
    ])

    const week = screen.getByRole('region', { name: 'This week' })
    expect(within(week).getByText('Google One')).toBeTruthy()
    expect(within(week).getByText('iCloud+')).toBeTruthy()
    expect(within(week).getByRole('heading').textContent).toContain('$109')

    const late = screen.getByRole('region', { name: 'Late' })
    expect(within(late).getByText('due 9 days ago')).toBeTruthy()
    expect(
      within(
        screen.getByRole('region', { name: 'After this month' }),
      ).getByText('Tithe'),
    ).toBeTruthy()
  })

  it('leaves out groups with nothing due', () => {
    render(
      <ComingUp
        today="2026-11-16"
        items={[due('Tithe', '2026-12-02', 20_200)]}
      />,
    )
    expect(screen.getAllByRole('region').map((g) => g.ariaLabel)).toEqual([
      'After this month',
    ])
  })
})
