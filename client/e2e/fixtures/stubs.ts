import type { ExperimentRow } from '@devnet-deftrack/shared';
import { ok, type ApiStubs } from '../harness.js';
import {
  chainLockReport,
  healthSnapshot,
  healthTimeline,
  llmqProfile,
  masternodeTimelinePoint,
  pageOf,
  roundDetail,
  roundRun,
} from './api.js';

/** What the shell's own header asks for, and nothing else. */
export function shellStubs(): ApiStubs {
  return {
    '/api/v1/health': { body: ok(healthSnapshot()) },
  };
}

/**
 * Every endpoint the public overview asks for, answered healthily.
 *
 * A test that wants one of them to fail replaces that single entry; the rest
 * stay honest, so the assertion is about the endpoint under test rather than
 * about a page with nothing in it.
 */
export function overviewStubs(): ApiStubs {
  return {
    ...shellStubs(),
    '/api/v1/chainlocks': { body: ok(chainLockReport()) },
    '/api/v1/quorum-rounds/health-timeline': { body: ok(healthTimeline()) },
    '/api/v1/quorum-rounds': { body: ok(pageOf(roundRun(5))) },
    '/api/v1/masternodes/timeline': {
      body: ok({ hours: 1, points: [masternodeTimelinePoint()] }),
    },
    '/api/v1/experiments': { body: ok(pageOf<ExperimentRow>([])) },
  };
}

/**
 * The DKG round list and any single round's detail.
 *
 * The detail stub is a prefix: the identifier is part of the path and is
 * percent-encoded (`7%3A7416%3A0`), which is exactly the shape the router
 * tests are about.
 */
export function roundStubs(): ApiStubs {
  return {
    ...shellStubs(),
    '/api/v1/quorum-rounds': { body: ok(pageOf(roundRun(5))) },
    '/api/v1/quorum-rounds/profiles': { body: ok({ items: [llmqProfile()] }) },
    '/api/v1/quorum-rounds/*': { body: ok(roundDetail()) },
    '/api/v1/experiments': { body: ok(pageOf<ExperimentRow>([])) },
    '/api/v1/masternodes/events': { body: ok(pageOf([])) },
  };
}
