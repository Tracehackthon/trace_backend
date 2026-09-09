import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const cli = path.join(packageRoot, 'dist', 'apps', 'cli', 'src', 'main.js');
if (!fs.existsSync(cli)) {
  console.error(`Trace runtime CLI is missing: ${cli}`);
  process.exitCode = 1;
} else {
  const result = spawnSync(process.execPath, [cli, ...process.argv.slice(2)], {
    stdio: 'inherit',
    env: {...process.env, TRACE_RUNTIME_ROOT: packageRoot},
  });
  if (result.error) {
    console.error(result.error.message);
    process.exitCode = 1;
  } else {
    process.exitCode = result.status ?? 1;
  }
}
