import { build } from 'esbuild'
import { copyFile, cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(fileURLToPath(import.meta.url))
const outDir = resolve(root, 'lib')
const desktopOutDir = resolve(outDir, 'desktop')
const discussionSourceDir = resolve(root, '../../apps/desktop')
const packageId = 'dsh-trace'

await rm(outDir, { recursive: true, force: true })
await mkdir(outDir, { recursive: true })

await build({
  absWorkingDir: root,
  entryPoints: ['src/index.ts'],
  outfile: resolve(outDir, 'index.js'),
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'node20',
  sourcemap: true,
  legalComments: 'none',
})

const clientResult = await build({
  absWorkingDir: root,
  entryPoints: ['src/client/apply.tsx'],
  bundle: true,
  format: 'cjs',
  platform: 'browser',
  target: 'es2020',
  external: ['react', 'react/*', '@deepseek-ai/*'],
  loader: { '.css': 'text', '.png': 'dataurl' },
  sourcemap: 'inline',
  write: false,
  legalComments: 'none',
})

const compiled = clientResult.outputFiles.find((file) => file.text.includes('module.exports')) ?? clientResult.outputFiles[0]
if (!compiled) throw new Error('client build did not produce JavaScript output')

const indent = compiled.text
  .split('\n')
  .map((line) => `\t\t${line}`)
  .join('\n')

const clientBundle = `window.__ModuleLoader__.load({\n\tid: ${JSON.stringify(packageId)},\n\tfactory: (require) => {\n\t\tvar module = { exports: {} };\n\t\tvar exports = module.exports;\n${indent}\n\t\treturn module.exports;\n\t}\n});\n`

await writeFile(resolve(outDir, 'client.js'), clientBundle, 'utf8')

await mkdir(desktopOutDir, { recursive: true })
await build({
  absWorkingDir: root,
  entryPoints: ['src/desktop/renderer.tsx'],
  outfile: resolve(desktopOutDir, 'renderer.js'),
  bundle: true,
  format: 'iife',
  platform: 'browser',
  target: 'chrome140',
  loader: { '.css': 'text', '.png': 'dataurl' },
  sourcemap: true,
  legalComments: 'none',
})

await Promise.all([
  copyFile(resolve(root, 'src/desktop/index.html'), resolve(desktopOutDir, 'index.html')),
  copyFile(resolve(root, 'src/desktop/main.mjs'), resolve(desktopOutDir, 'main.mjs')),
  copyFile(resolve(root, 'src/desktop/preload.cjs'), resolve(desktopOutDir, 'preload.cjs')),
  copyFile(resolve(root, 'src/desktop/discussion-preload.cjs'), resolve(desktopOutDir, 'discussion-preload.cjs')),
  copyFile(resolve(root, 'src/client/assets/liukanshan.png'), resolve(desktopOutDir, 'liukanshan.png')),
])

const discussionOutDir = resolve(desktopOutDir, 'discussion')
await mkdir(discussionOutDir, { recursive: true })
await Promise.all([
  copyFile(resolve(discussionSourceDir, 'index.html'), resolve(discussionOutDir, 'index.html')),
  cp(resolve(discussionSourceDir, 'src'), resolve(discussionOutDir, 'src'), { recursive: true }),
  cp(resolve(discussionSourceDir, 'public'), resolve(discussionOutDir, 'public'), { recursive: true }),
])

const manifest = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'))
console.log(`Built ${manifest.name}@${manifest.version}`)
console.log(`- ${resolve(outDir, 'index.js')}`)
console.log(`- ${resolve(outDir, 'client.js')}`)
console.log(`- ${resolve(desktopOutDir, 'main.mjs')}`)
console.log(`- ${resolve(desktopOutDir, 'renderer.js')}`)
console.log(`- ${resolve(discussionOutDir, 'index.html')}`)
