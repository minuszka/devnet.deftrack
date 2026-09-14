import pathlib,subprocess,json,hashlib,re
E=pathlib.Path(__file__).parent;R=pathlib.Path(r'D:\www\deftrack-review-rpc-65dcadf')
files=list((R/'server/src/services').glob('rpc*.ts'))
hashfiles=lambda:{p.name:hashlib.sha256(p.read_bytes()).hexdigest() for p in files}
before=hashfiles();results=[]
changes={
 'baseline':[],
 'no-pool-timeout':[['timeout: idleSocketMs','timeout: 0',2]],
 'first-error':[['logger.warn(`RPC ${method}: ${sanitised} (transport error, retrying once)`);','logger.error(`RPC ${method}: ${sanitised} (transport error, retrying once)`);',1]],
 'retry-warn':[['return this.doCall<T>(method, params, options, false);','return this.doCall<T>(method, params, options, true);',1]],
 'request-timeout':[['timeout: endpoint.timeoutMs','timeout: idleSocketMs',1],['timeout: idleSocketMs })','timeout: 0 })',2]],
 # Independent extra: missing production default. Existing tests explicitly override the idle limit.
 'missing-default':[['const DEFAULT_IDLE_SOCKET_MS = 15_000;','const DEFAULT_IDLE_SOCKET_MS = 0;',1]],
}
for name,replacements in changes.items():
 config='''export default { root: ROOT, plugins:[{name:'review-in-memory-control',enforce:'pre', transform(code,id) { if(!id.replaceAll('\\\\','/').endsWith('/services/rpc.service.ts')) return; for(const [a,b,n] of REPLACEMENTS) {if(code.split(a).length-1!==n) throw new Error('mutation match count');code=code.replaceAll(a,b);} return {code,map:null}; }}],test:{include:['src/services/rpc.service.test.ts','src/services/rpc.keepalive.test.ts'],fileParallelism:false}};'''.replace('ROOT',json.dumps(str(R/'server').replace('\\','/'))).replace('REPLACEMENTS',json.dumps(replacements))
 cp=E/(name+'.config.mjs');cp.write_text(config)
 p=subprocess.run(['node',str(R/'node_modules/vitest/vitest.mjs'),'run','--config',str(cp)],cwd=R/'server',capture_output=True,text=True,encoding='utf-8',errors='replace',timeout=60)
 log=re.sub(r'\x1b\[[0-9;]*m','',p.stdout+p.stderr)
 log=re.sub(r'\b(?:\d{1,3}\.){3}\d{1,3}\b','[redacted-address]',log)
 (E/(name+'.log')).write_text(log,encoding='utf-8')
 results.append({'variant':name,'exit_code':p.returncode,'summary':[s.strip() for s in log.splitlines() if re.search(r'Test Files|Tests  |FAIL |Error:',s)]})
 print(json.dumps(results[-1]))
after=hashfiles();assert before==after
(E/'negative-controls.json').write_text(json.dumps({'results':results,'source_before':before,'source_after':after,'source_unchanged':before==after},indent=2)+'\n')
