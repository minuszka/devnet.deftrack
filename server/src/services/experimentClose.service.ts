import { config } from '../config.js';
import { IncompleteExperimentWindow } from '../domain/experimentCoverage.js';
import { Block } from '../models/Block.js';
import { SyncState } from '../models/SyncState.js';
import { computeOutcome } from './experiment.service.js';
import { DIFF_CURSOR_KEY } from './mnListDiff.service.js';
import { rpc } from './rpc.service.js';

async function indexedEndHash(endHeight: number): Promise<string> {
  const keys = endHeight > 1 ? ['blocks', DIFF_CURSOR_KEY] : ['blocks'];
  const cursors = await SyncState.find({ key: { $in: keys } }).select('key lastSyncedHeight').lean();
  for (const key of keys) {
    const height = cursors.find((row) => row.key === key)?.lastSyncedHeight ?? -1;
    if (height < endHeight) throw new IncompleteExperimentWindow(`${key} indexed to ${height}; need ${endHeight}`);
  }
  const end = await Block.findOne({ height: endHeight }).select('hash').lean();
  if (!end) throw new IncompleteExperimentWindow(`Missing indexed end block at height ${endHeight}`);
  return end.hash;
}

export async function outcomeForClose(startHeight: number, endHeight: number) {
  const hash = await indexedEndHash(endHeight);
  const count = await Block.countDocuments({ height: { $gte: startHeight, $lte: endHeight } });
  if (count !== endHeight - startHeight + 1) {
    throw new IncompleteExperimentWindow(`Indexed ${count} blocks in the window ${startHeight}..${endHeight}`);
  }
  const outcome = await computeOutcome({ startHeight, endHeight }, endHeight, config.dsl);
  // A rewind can overlap the independent collection reads on a standalone MongoDB.
  const [indexedHash, nodeHash] = await Promise.all([indexedEndHash(endHeight), rpc.getBlockHash(endHeight)]);
  if (hash !== indexedHash || hash !== nodeHash) {
    throw new IncompleteExperimentWindow(`Index and node disagree on the end block at height ${endHeight}; retry after sync`);
  }
  return outcome;
}
