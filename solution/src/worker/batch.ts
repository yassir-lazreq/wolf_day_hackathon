import { runBatch } from './run-batch.ts';

runBatch().catch((e) => {
  console.error('[batch] fatal:', e);
  process.exit(1);
});
