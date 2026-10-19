// A test-only cross-platform graceful shutdown channel. On Windows,
// child.kill('SIGTERM') terminates the process without running JS handlers.
import { ready, close } from '../../apps/desktop/server.mjs';

await ready;
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => {
  if (chunk.trim() !== 'stop') return;
  void close().then(() => process.stdin.destroy()).catch(error => {
    console.error(error); process.exitCode = 1; process.stdin.destroy();
  });
});
