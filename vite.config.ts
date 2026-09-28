import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
export default defineConfig({
  plugins: [react(), tailwindcss()],
  // supabase/tests/db.test.mjs is a standalone PGlite integration script run via
  // `npm run test:db`, not a vitest suite — exclude it so vitest only picks up
  // real *.test.ts unit tests.
  test: { environment: 'node', exclude: ['node_modules/**', 'supabase/tests/**'] },
})
