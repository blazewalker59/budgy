/**
 * Every chart, loaded on demand: TanStack Charts arrives only when a chart
 * is first shown. Each holds its height while loading, so nothing below it
 * jumps. Import charts from here, not their modules.
 */

import { Suspense, lazy } from 'react'
import type { ComponentProps, ComponentType } from 'react'
import type { CategoryTrend as CategoryTrendType } from './CategoryTrend'
import type { ForecastChart as ForecastChartType } from './ForecastChart'
import type { IncomeChart as IncomeChartType } from './IncomeChart'
import type { IncomeMonths as IncomeMonthsType } from './IncomeMonths'
import type { MixChart as MixChartType } from './MixChart'
import type { WorthChart as WorthChartType } from './WorthChart'
import type { TrendSpark as TrendSparkType } from './TrendSpark'

import type { PlanChart as PlanChartType } from './PlanChart'
import type { SourceChart as SourceChartType } from './SourceChart'
import type { SelectionMonths as SelectionMonthsType } from './SelectionMonths'

function Placeholder({ height, bare }: { height: number; bare?: boolean }) {
  return (
    <div
      aria-hidden="true"
      className={
        bare
          ? 'animate-pulse'
          : 'animate-pulse rounded-xl border border-border bg-surface'
      }
      style={{ height }}
    />
  )
}

function lazyChart<TProps extends object>(
  load: () => Promise<ComponentType<TProps>>,
  height: number,
  bare = false,
) {
  const Lazy = lazy(() => load().then((component) => ({ default: component })))
  return function LazyChart(props: TProps) {
    return (
      <Suspense fallback={<Placeholder height={height} bare={bare} />}>
        <Lazy {...props} />
      </Suspense>
    )
  }
}

export const MixChart = lazyChart<ComponentProps<typeof MixChartType>>(
  () => import('./MixChart').then((m) => m.MixChart),
  66,
  true,
)
export const TrendSpark = lazyChart<ComponentProps<typeof TrendSparkType>>(
  () => import('./TrendSpark').then((m) => m.TrendSpark),
  20,
  true,
)
export const CategoryTrend = lazyChart<
  ComponentProps<typeof CategoryTrendType>
>(() => import('./CategoryTrend').then((m) => m.CategoryTrend), 230)
export const ForecastChart = lazyChart<
  ComponentProps<typeof ForecastChartType>
>(() => import('./ForecastChart').then((m) => m.ForecastChart), 210)

export const PlanChart = lazyChart<ComponentProps<typeof PlanChartType>>(
  () => import('./PlanChart').then((m) => m.PlanChart),
  420,
)
export const SourceChart = lazyChart<ComponentProps<typeof SourceChartType>>(
  () => import('./SourceChart').then((m) => m.SourceChart),
  170,
)
export const SelectionMonths = lazyChart<
  ComponentProps<typeof SelectionMonthsType>
>(() => import('./SelectionMonths').then((m) => m.SelectionMonths), 170)
export const IncomeChart = lazyChart<ComponentProps<typeof IncomeChartType>>(
  () => import('./IncomeChart').then((m) => m.IncomeChart),
  66,
  true,
)
export const IncomeMonths = lazyChart<ComponentProps<typeof IncomeMonthsType>>(
  () => import('./IncomeMonths').then((m) => m.IncomeMonths),
  200,
)
export const WorthChart = lazyChart<ComponentProps<typeof WorthChartType>>(
  () => import('./WorthChart').then((m) => m.WorthChart),
  200,
)
