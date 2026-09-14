import { build } from 'esbuild'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(fileURLToPath(import.meta.url))
const outDir = resolve(root, 'lib')
const packageId = 'dsh-trace'

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

const manifest = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'))
console.log(`Built ${manifest.name}@${manifest.version}`)
console.log(`- ${resolve(outDir, 'index.js')}`)
console.log(`- ${resolve(outDir, 'client.js')}`)
