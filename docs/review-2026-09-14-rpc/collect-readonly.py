import subprocess,json,pathlib,re,datetime,urllib.request,hashlib
E=pathlib.Path(__file__).parent
R=pathlib.Path(r'D:\www\deftrack-review-rpc-65dcadf')
def run(args):
 p=subprocess.run(args,capture_output=True,text=True,encoding='utf-8',errors='replace',timeout=60)
 return p
out={}
p=run(['ssh','-o','BatchMode=yes','-o','StrictHostKeyChecking=yes','devnet','journalctl -u deftrack-devnet --since "2026-09-14 00:00:00 UTC" --until "2026-09-14 04:00:00 UTC" --no-pager -o json'])
events=[]
for line in p.stdout.splitlines():
 try:d=json.loads(line)
 except:continue
 msg=d.get('MESSAGE','')
 if not isinstance(msg,str):continue
 if 'getnetworkinfo' in msg and ('socket hang up' in msg or 'retry' in msg):
  ts=datetime.datetime.fromtimestamp(int(d['__REALTIME_TIMESTAMP'])/1e6,datetime.timezone.utc).isoformat()
  events.append({'utc':ts,'event':'getnetworkinfo_socket_hang_up' if 'socket hang up' in msg else 'getnetworkinfo_retry'})
out['journal']={'exit_code':p.returncode,'events':events,'raw_journal_saved':False}
for key,cmd,pattern in [('node','node --version',r'v\d+\.\d+\.\d+'),('deployed_head','git -C /opt/devnet-deftrack/app rev-parse HEAD',r'[0-9a-f]{40}'),('service','systemctl show deftrack-devnet -p ActiveState -p SubState -p NRestarts',r'(?:ActiveState|SubState|NRestarts)=[a-z0-9]+')]:
 p=run(['ssh','-o','BatchMode=yes','-o','StrictHostKeyChecking=yes','devnet',cmd]);out[key]={'exit_code':p.returncode,'values':re.findall(pattern,p.stdout)}
(E/'remote-readonly.json').write_text(json.dumps(out,indent=2)+'\n')
print(json.dumps(out,indent=2))
core={}
p=run(['wsl','--exec','git','-C','/home/stejn/DEFCON','rev-parse','HEAD']);core['head']=p.stdout.strip()
for f in ['src/httpserver.h','src/httpserver.cpp']:
 p=run(['wsl','--exec','git','-C','/home/stejn/DEFCON','show','HEAD:'+f]);lines=p.stdout.splitlines()
 core[f]={'sha256':hashlib.sha256(p.stdout.encode()).hexdigest(),'matches':[{'line':i+1,'text':s} for i,s in enumerate(lines) if 'DEFAULT_HTTP_SERVER_TIMEOUT' in s or 'evhttp_set_timeout' in s or 'rpcservertimeout' in s]}
(E/'core-timeout.json').write_text(json.dumps(core,indent=2)+'\n');print(json.dumps(core,indent=2))
ci={}
for sha in ['310bfb25d7a13d8da885cc15df944c9954df417b','65dcadf3c314a93aced4abc103eb60045880dac4']:
 req=urllib.request.Request('https://api.github.com/repos/minuszka/devnet.deftrack/commits/'+sha+'/check-runs',headers={'User-Agent':'independent-review'})
 try:
  with urllib.request.urlopen(req,timeout=30) as r:d=json.load(r)
  ci[sha]=[{'name':c['name'],'status':c['status'],'conclusion':c['conclusion'],'id':c['id'],'completed_at':c['completed_at']} for c in d['check_runs']]
 except Exception as ex:ci[sha]={'error_type':type(ex).__name__}
(E/'ci.json').write_text(json.dumps(ci,indent=2)+'\n');print(json.dumps(ci,indent=2))
