import { defineConfig } from 'vitest/config'
import tsconfigPaths from 'vite-tsconfig-paths'
import { tanstackStart } from '@tanstack/react-start/plugin/vite'
import viteReact from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { cloudflare } from '@cloudflare/vite-plugin'

const isTest = process.env.VITEST === 'true'

const config = defineConfig({
  define: {
    // Surfaced by `GET /health` as `version`. CI builds carry the deploying
    // commit; local builds report nothing.
    __BUDGY_VERSION__: JSON.stringify(process.env.GITHUB_SHA ?? ''),
  },
  test: {
    globals: true,
    environment: 'node',
    include: ['src/__tests__/**/*.test.{ts,tsx}'],
  },
  plugins: [
    tsconfigPaths(),
    // Cloudflare plugin conflicts with Vitest (sets resolve.external for SSR).
    !isTest && cloudflare({ viteEnvironment: { name: 'ssr' } }),
    tailwindcss(),
    tanstackStart(),
    viteReact(),
  ],
})

export default config
