import {TraceRuntime} from '../../dist/packages/core/runtime/src/index.js';

const [database, prefix, rawCount, mode = 'independent'] = process.argv.slice(2);
const count = Number(rawCount);
if (!database || !prefix || !Number.isInteger(count) || count < 1) throw new Error('usage: sqlite-concurrency-worker.mjs DATABASE PREFIX COUNT [independent|same]');

const runtime = new TraceRuntime({sqliteStateFile: database});
try {
  for (let index = 0; index < count; index += 1) {
    const id = mode === 'same' ? 'concurrent-shared-thread' : `concurrent-${prefix}-${index}`;
    runtime.createThread({
      thread_id: id,
      title: `Concurrent ${prefix}`,
      current_summary: `write ${index} from ${prefix}`,
      next_action: 'Verify append-only state',
    });
  }
} finally {
  runtime.close();
}
