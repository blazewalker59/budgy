import { createFileRoute } from '@tanstack/react-router'
import { ImportScreen } from '@/components/import/ImportScreen'

export const Route = createFileRoute('/import')({
  component: ImportScreen,
})
