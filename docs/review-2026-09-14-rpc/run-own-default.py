import pathlib,json,subprocess,re
E=pathlib.Path(__file__).parent;R=pathlib.Path(r'D:\www\deftrack-review-rpc-65dcadf');results=[]
for name in ['baseline','missing-default']:
 cfg="import base from './"+name+".config.mjs';export default {...base,test:{include:["+json.dumps(str(E/'defaults.test.ts').replace('\\','/'))+"]}};"
 cp=E/('own-'+name+'.config.mjs');cp.write_text(cfg)
 p=subprocess.run(['node',str(R/'node_modules/vitest/vitest.mjs'),'run','--config',str(cp)],cwd=R/'server',capture_output=True,text=True,encoding='utf-8',errors='replace',timeout=60)
 text=re.sub(r'\x1b\[[0-9;]*m','',p.stdout+p.stderr);(E/('own-'+name+'.log')).write_text(text,encoding='utf-8')
 results.append({'variant':name,'exit_code':p.returncode,'summary':[l.strip() for l in text.splitlines() if 'Tests ' in l or 'Error:' in l]})
(E/'own-default-results.json').write_text(json.dumps(results,indent=2)+'\n');print(json.dumps(results,indent=2))

