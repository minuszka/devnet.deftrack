import http from 'node:http';
import {createRequire} from 'node:module';
import {writeFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
const require=createRequire('D:/www/deftrack-review-rpc-65dcadf/server/package.json');
const axios=require('axios');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const loopback=[127,0,0,1].join('.');
const results=[];
for(const idle of [100,0]) {
 let connections=0; const sockets=new Set();
 const server=http.createServer((req,res)=>{res.setHeader('Connection','keep-alive');res.setHeader('Keep-Alive','max=1000');setTimeout(()=>res.end('ok'),req.url==='/slow'?450:0);});
 server.keepAliveTimeout=300; server.keepAliveTimeoutBuffer=0;
 server.on('connection',s=>{connections++;sockets.add(s);s.on('close',()=>sockets.delete(s));});
 await new Promise(r=>server.listen(0,loopback,r));
 const agent=new http.Agent({keepAlive:true,maxSockets:16,timeout:idle});
 const client=axios.create({baseURL:`http://${loopback}:${server.address().port}`,httpAgent:agent,timeout:1500,maxRedirects:0,proxy:false});
 const start=performance.now(); await client.get('/');
 const socket=Object.values(agent.freeSockets)[0][0]; const freed=performance.now();let closeAfterFree=null;
 socket.once('close',()=>closeAfterFree=Math.round(performance.now()-freed));
 await sleep(200); const aliveAt200=!socket.destroyed;
 await sleep(260);await client.get('/');
 const late={idle,aliveAt200,closeAfterFree,connectionsAfterLateCall:connections};
 assert.equal(aliveAt200,idle===0); assert.equal(connections,2);
 // Reuse an existing socket for a request lasting more than the pool limit.
 const before=connections;const t=performance.now(); const slow=await client.get('/slow');
 late.reusedSlowMs=Math.round(performance.now()-t);late.reusedSlowSucceeded=slow.data==='ok';late.reusedSlowNewConnections=connections-before;
 assert.equal(connections,before);assert(late.reusedSlowMs>=400);
 await sleep(30);assert.equal((await client.get('/')).data,'ok');
 late.freeTimeout=Object.values(agent.freeSockets)[0][0].timeout;
 // Request timeout continues to abort a slow call independently of idle limit.
 let requestTimedOut=false;
 try {await client.get('/slow',{timeout:150});}catch(e){requestTimedOut=e.code==='ECONNABORTED';}
 assert(requestTimedOut);late.requestTimeoutWorks=requestTimedOut;
 results.push(late);agent.destroy();for(const s of sockets)s.destroy();await new Promise(r=>server.close(r));
}
const source=process.binding('natives')._http_agent.split('\n');
const snippets=source.map((text,i)=>({line:i+1,text})).filter(x=>[ [450,473],[553,594],[610,617] ].some(([a,b])=>x.line>=a&&x.line<=b));
const output={node:process.version,axios:require('axios/package.json').version,results,agentSource:snippets};
writeFileSync(new URL('agent-measurement.json',import.meta.url),JSON.stringify(output,null,2)+'\n');
console.log(JSON.stringify({...output,agentSource:undefined},null,2));
