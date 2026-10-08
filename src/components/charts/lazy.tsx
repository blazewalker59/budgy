/**
 * Every chart, loaded on demand: TanStack Charts arrives only when a chart
 * is first shown. Each holds its height while loading, so nothing below it
 * jumps. Import charts from here, not their modules.
 */

import { Suspense, lazy } from 'react'
import type { ComponentProps, ComponentType } from 'react'
import type { CategoryTrend as CategoryTrendType } from './CategoryTrend'
import type { ForecastChart as ForecastChartType } from './ForecastChart'
import type { MixChart as MixChartType } from './MixChart'
import type { TrendSpark as TrendSparkType } from './TrendSpark'

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
