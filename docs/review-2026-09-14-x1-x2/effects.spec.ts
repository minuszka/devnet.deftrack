import { test, expect, fail } from '../../../deftrack-review-458b6d0/client/e2e/harness.js';
import { adminSessionStubs, runStubs, RUN_A } from '../../../deftrack-review-458b6d0/client/e2e/fixtures/admin.js';
const A = `/api/v1/admin/simulations/runs/${RUN_A}`;
async function stop(page: import('@playwright/test').Page) {
  await page.clock.install({time:new Date('2026-09-14T00:00:00Z')});
  await page.clock.pauseAt(new Date('2026-09-14T00:00:01Z'));
}
test('a slow initial evidence read postpones the plan error but not the polled run abort', async ({app,page}) => {
  const evidence = app.gate(); let count=0;
  const stubs = runStubs({runKey:RUN_A,status:'fault_active',revision:9,live:true,faultMayBeActive:true});
  app.stub({...adminSessionStubs(),...stubs,
    [`${A}/dry-run`]:{status:503,body:fail('plan store unavailable')},
    [`${A}/recovery`]:()=> ++count===1 ? {status:503,body:fail('evidence unavailable'),gate:evidence} : stubs[`${A}/recovery`] as any,
  });
  await stop(page); await app.goto(`/admin?run=${RUN_A}`); await evidence.waitForHeld();
  await page.clock.fastForward(5000);
  await expect(page.locator('.run-state')).toContainText(RUN_A);
  await expect(page.getByRole('button',{name:'Abort & recover'})).toBeEnabled();
  await expect(page.locator('.plan-unread')).toContainText('still being read');
  await evidence.release();
  await expect(page.locator('.plan-unread')).toContainText('could not be read');
  await expect(page.getByRole('button',{name:'Abort & recover'})).toBeEnabled();
});
for (const delayed of ['history','dry-run']) {
  test(`double 503 chooses the plan error with ${delayed} arriving last`,async({app,page})=>{
    const late=app.gate();
    app.stub({...adminSessionStubs(),...runStubs({runKey:RUN_A,status:'completed',revision:9}),
      [`${A}/dry-run`]:{status:503,body:fail('plan-error-sentinel'),...(delayed==='dry-run'?{gate:late}:{})},
      [`${A}/history`]:{status:503,body:fail('history-error-sentinel'),...(delayed==='history'?{gate:late}:{})},
    });
    await stop(page); await app.goto(`/admin?run=${RUN_A}`); await late.waitForHeld();
    await app.waitUntilRead(`${A}/${delayed==='history'?'dry-run':'history'}`,1);
    await late.release();
    await expect(page.locator('dd-admin-shell .alert').first()).toContainText('plan-error-sentinel');
    await expect(page.getByRole('button',{name:'Sign out',exact:true})).toBeVisible();
  });
}
