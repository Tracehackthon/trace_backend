import { defineConfig } from 'tsdown'

// This is the equivalent tsdown entry map for a published package. The local
// build script uses esbuild because the installed Harness runtime only needs
// the two generated artifacts and does not ship tsdown itself.
export default defineConfig({
  entry: {
    index: 'src/index.ts',
    client: 'src/client/apply.tsx',
  },
  format: ['esm'],
  dts: false,
  sourcemap: true,
})
