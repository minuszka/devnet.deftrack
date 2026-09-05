import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { LLMQ_PROFILES } from '../config/llmq.js';
import { formingCycleBaseHeight, resolveFormingQuorum, type QuorumChainSource } from './formingQuorum.js';
import type { QuorumSelectionMasternode } from './quorumMemberSelection.js';

interface Fixture {
  masternodes: QuorumSelectionMasternode[];
  vectors: Array<{
    llmqType: number;
    llmqName: string;
    size: number;
    cycleBaseHeight: number;
    cycleBaseBlockHash: string;
    expectedMemberIndexes: number[];
  }>;
  negativeControl: { height: number; blockHash: string };
}

const fixture = JSON.parse(
  readFileSync(new URL('./fixtures/quorum-member-selection.devnet.json', import.meta.url), 'utf8')
) as Fixture;

const defcon = LLMQ_PROFILES.llmq_defcon!;
const at8304 = fixture.vectors.find((vector) => vector.llmqName === 'llmq_defcon')!;
const at8280 = fixture.vectors.find((vector) => vector.llmqName === 'llmq_400_60')!;
const members = (vector: Fixture['vectors'][number]) =>
  vector.expectedMemberIndexes.map((index) => fixture.masternodes[index]!.proTxHash);

/** A chain that knows the fixture's two base blocks and nothing else. */
function source(overrides: Partial<QuorumChainSource> = {}): QuorumChainSource & { calls: string[] } {
  const calls: string[] = [];
  const hashes = new Map<number, string>([
    [8304, at8304.cycleBaseBlockHash],
    [8280, at8280.cycleBaseBlockHash],
    [8296, fixture.negativeControl.blockHash],
  ]);
  return {
    calls,
    getBlockHash: async (height) => {
      calls.push(`hash:${height}`);
      const hash = hashes.get(height);
      if (hash === undefined) throw new Error(`Block height out of range: ${height}`);
      return hash;
    },
    masternodeListAt: async (height) => {
      calls.push(`list:${height}`);
      return fixture.masternodes;
    },
    ...overrides,
  };
}

// llmq_defcon has a 24-block interval, so 8280 and 8304 are consecutive cycle
// bases. The formed quorum at 8280 verifies the selection; 8304 is forming.
const formedAt8280 = {
  quorumHash: at8280.cycleBaseBlockHash,
  expectedHeight: 8280,
  // llmq_400_60 at 8280 seated everyone; the llmq_defcon members are a
  // different selection of the same list, computed here for the test's own
  // "current" evidence.
  memberProTxHashes: [] as string[],
};

describe('formingCycleBaseHeight', () => {
  it('is the cycle the tip is inside of', () => {
    expect(formingCycleBaseHeight(8304, defcon)).toBe(8304);
    expect(formingCycleBaseHeight(8320, defcon)).toBe(8304);
    expect(formingCycleBaseHeight(8327, defcon)).toBe(8304);
    expect(formingCycleBaseHeight(8328, defcon)).toBe(8328);
    expect(() => formingCycleBaseHeight(-1, defcon)).toThrow(/invalid/);
  });
});

describe('resolveFormingQuorum', () => {
  async function currentAt8280(): Promise<typeof formedAt8280> {
    // Derive the committed member list the way the node would have, so the
    // self-check compares against a genuinely formed quorum of this profile.
    const { selectQuorumMembers } = await import('./quorumMemberSelection.js');
    return {
      ...formedAt8280,
      memberProTxHashes: selectQuorumMembers({
        llmqType: defcon.llmqType, size: defcon.size, useRotation: false, v20Active: false,
        cycleBaseBlockHash: at8280.cycleBaseBlockHash, masternodes: fixture.masternodes,
      }),
    };
  }

  it('names the forming quorum from its base block, in the node order, after reproducing the formed one', async () => {
    const chain = source();
    const result = await resolveFormingQuorum({
      tipHeight: 8320, profile: defcon, v20Active: false, current: await currentAt8280(), source: chain,
    });
    expect(result.nextUnavailableReason).toBeNull();
    expect(result.selfCheck).toMatchObject({ passed: true, orderMatched: true, verifiedAgainst: { expectedHeight: 8280 } });
    expect(result.next).toMatchObject({
      llmqType: 7, llmqName: 'llmq_defcon', quorumHash: at8304.cycleBaseBlockHash, expectedHeight: 8304,
      quorumIndex: 0, capturedAtHeight: 8320, provenance: 'computed',
      verifiedAgainstQuorumHash: at8280.cycleBaseBlockHash,
    });
    // The devnet committed exactly this list at 8304 (quorum info, fixture).
    expect(result.next?.memberProTxHashes).toEqual(members(at8304));
    expect(chain.calls).toEqual(['hash:8280', 'list:8280', 'hash:8304', 'list:8304']);
  });

  it('refuses to offer a forming quorum when the selection cannot reproduce the formed one', async () => {
    const current = await currentAt8280();
    const tampered = { ...current, memberProTxHashes: [...current.memberProTxHashes.slice(1), fixture.masternodes[0]!.proTxHash] };
    const chain = source();
    const result = await resolveFormingQuorum({ tipHeight: 8320, profile: defcon, v20Active: false, current: tampered, source: chain });
    expect(result.next).toBeNull();
    expect(result.nextUnavailableReason).toMatch(/failed to reproduce/);
    expect(result.selfCheck).toMatchObject({ passed: false });
    expect(result.selfCheck?.detail).toMatch(/sets differ/);
    // and it stopped there: the forming base block was never read
    expect(chain.calls).not.toContain('hash:8304');
  });

  it('treats a recorded quorum hash that is not the node block hash as a failed check, not a guess', async () => {
    const current = { ...(await currentAt8280()), quorumHash: fixture.negativeControl.blockHash };
    const result = await resolveFormingQuorum({ tipHeight: 8320, profile: defcon, v20Active: false, current, source: source() });
    expect(result.next).toBeNull();
    expect(result.selfCheck?.detail).toMatch(/recorded quorum hash/);
  });

  it('does not trust itself without a formed quorum to check against', async () => {
    const chain = source();
    const result = await resolveFormingQuorum({ tipHeight: 8320, profile: defcon, v20Active: false, current: null, source: chain });
    expect(result.next).toBeNull();
    expect(result.nextUnavailableReason).toMatch(/cannot be verified/);
    expect(chain.calls).toEqual([]);
  });

  it('says the next base block is unmined once the current cycle is committed, instead of predicting', async () => {
    const current = { ...(await currentAt8280()), quorumHash: at8304.cycleBaseBlockHash, expectedHeight: 8304, memberProTxHashes: members(at8304) };
    const result = await resolveFormingQuorum({ tipHeight: 8320, profile: defcon, v20Active: false, current, source: source() });
    expect(result.next).toBeNull();
    expect(result.nextUnavailableReason).toMatch(/base block 8328 is 8 block\(s\) away/);
    expect(result.selfCheck?.passed).toBe(true);
  });

  it('refuses the paths it does not reproduce and the heights the node never forms at', async () => {
    const current = await currentAt8280();
    const rotated = await resolveFormingQuorum({
      tipHeight: 8320, profile: { ...defcon, useRotation: true }, v20Active: false, current, source: source(),
    });
    expect(rotated.nextUnavailableReason).toMatch(/rotates/);
    const v20 = await resolveFormingQuorum({ tipHeight: 8320, profile: defcon, v20Active: true, current, source: source() });
    expect(v20.nextUnavailableReason).toMatch(/v20/);
    const belowGate = await resolveFormingQuorum({
      tipHeight: 3100, profile: defcon, v20Active: false, current, source: source(),
    });
    expect(belowGate.nextUnavailableReason).toMatch(/cannot form below height 3120/);
  });

  it('lets a node failure surface as an error for the caller to record, never as a member list', async () => {
    const current = await currentAt8280();
    const chain = source({ masternodeListAt: async () => { throw new Error('protx diff: evodb miss'); } });
    await expect(
      resolveFormingQuorum({ tipHeight: 8320, profile: defcon, v20Active: false, current, source: chain })
    ).rejects.toThrow(/evodb miss/);
  });
});
