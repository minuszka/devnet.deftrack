import {expect,it,vi} from 'vitest';
const state=vi.hoisted(()=>({configs:[] as any[]}));
vi.mock('axios',()=>({default:{create:(cfg:any)=>{state.configs.push(cfg);return {interceptors:{response:{use:()=>undefined}}};}}}));
vi.mock('D:/www/deftrack-review-rpc-65dcadf/server/src/config.js',()=>({config:{rpc:{host:'unused',port:1,user:'u',pass:'p',timeoutMs:2000}}}));
vi.mock('D:/www/deftrack-review-rpc-65dcadf/server/src/utils/logger.js',()=>({logger:{}}));
vi.mock('D:/www/deftrack-review-rpc-65dcadf/server/src/services/metrics.service.js',()=>({metricsService:{}}));
import {RpcService} from 'D:/www/deftrack-review-rpc-65dcadf/server/src/services/rpc.service.ts';
it('production and peer defaults both retain a 15-second pool timeout and independent request timeout',()=>{
 state.configs.length=0;
 new RpcService();
 new RpcService({host:'unused',port:1,user:'u',pass:'p',timeoutMs:4000},'peer:');
 expect(state.configs).toHaveLength(2);
 expect(state.configs.map(c=>c.timeout)).toEqual([2000,4000]);
 for(const c of state.configs){expect(c.httpAgent.options.timeout).toBe(15000);expect(c.httpsAgent.options.timeout).toBe(15000);expect(c.httpAgent.options.maxSockets).toBe(16);c.httpAgent.destroy();c.httpsAgent.destroy();}
});
