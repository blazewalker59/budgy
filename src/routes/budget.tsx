import { createFileRoute } from '@tanstack/react-router'
import { BudgetScreen } from '@/components/budget/BudgetScreen'

export const Route = createFileRoute('/budget')({
  component: BudgetScreen,
})
