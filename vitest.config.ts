import { defineConfig } from 'vitest/config'
import path from 'node:path'

export default defineConfig({
  test: {
    include: ['electron/**/*.test.ts', 'src/**/*.test.ts'],
    environment: 'node',
    globals: false,
    pool: 'forks',
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
})
