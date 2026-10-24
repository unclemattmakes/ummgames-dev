import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    projects: [
      {
        test: {
          name: 'unit',
          include: ['tests/**/*.test.mjs'],
          exclude: ['tests/**/*.slow.test.mjs'],
        },
      },
      { test: { name: 'slow', include: ['tests/**/*.slow.test.mjs'], testTimeout: 180_000 } },
    ],
  },
})
