import pathlib,subprocess,json,hashlib,urllib.request,re
E=pathlib.Path(__file__).parent;R=pathlib.Path(r'D:\www\deftrack-review-rpc-65dcadf')
def git(*args):return subprocess.check_output(['git','-C',str(R),*args])
lock=json.loads((R/'package-lock.json').read_text())
identity={'head':git('rev-parse','HEAD').decode().strip(),'pr_head':git('rev-parse','310bfb2').decode().strip(),'base':git('rev-parse','65dcadf^1').decode().strip(),'diff_sha256':hashlib.sha256(git('diff','65dcadf^1','65dcadf','--')).hexdigest(),'git_status':git('status','--porcelain').decode(),'node':subprocess.check_output(['node','--version']).decode().strip(),'axios_lock':lock['packages']['node_modules/axios']['version'],'source_sha256':{str(p.relative_to(R)):hashlib.sha256(p.read_bytes()).hexdigest() for p in (R/'server/src/services').glob('rpc*.ts')}}
(E/'identity.json').write_text(json.dumps(identity,indent=2)+'\n');print(json.dumps(identity,indent=2))
url='https://raw.githubusercontent.com/nodejs/node/v24.19.0/lib/_http_agent.js'
with urllib.request.urlopen(url,timeout=30) as r:source=r.read()
lines=source.decode().splitlines();selected=[]
for i,line in enumerate(lines):
 if any(k in line for k in ['function onTimeout','Agent.prototype.keepSocketAlive','function setRequestSocket']):
  end=next((j for j in range(i+1,len(lines)) if lines[j] in ['}','};','  }']),min(i+45,len(lines)))
  selected.extend({'line':j+1,'text':lines[j]} for j in range(i,end+1))
(E/'node-24.19-agent-source.json').write_text(json.dumps({'version':'v24.19.0','source_sha256':hashlib.sha256(source).hexdigest(),'source_url':url,'snippets':selected},indent=2)+'\n')
remote=json.loads((E/'remote-readonly.json').read_text());drops=[e for e in remote['journal']['events'] if e['event']=='getnetworkinfo_socket_hang_up'];summary={'total_in_four_hour_query':len(drops),'incident_window':[e['utc'] for e in drops if '02:18:'<=e['utc'][11:19]<='02:29:59'],'seconds':sorted(set(e['utc'][17:19] for e in drops)),'success_not_proven_by_retry_start_message':True}
(E/'journal-summary.json').write_text(json.dumps(summary,indent=2)+'\n');print(json.dumps(summary,indent=2))
for p in E.glob('*.log'):
 text=p.read_text(encoding='utf-8-sig',errors='replace')
 count=len(re.findall(r'\b(?:\d{1,3}\.){3}\d{1,3}\b',text))
 if count:print('address-patterns:',p.name,count)
