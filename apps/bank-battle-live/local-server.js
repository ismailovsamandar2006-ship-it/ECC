import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import os from 'node:os';
import game from './api/game.js';
import qr from './api/qr.js';
process.env.LOCAL_DEMO='1';
// Static pages live in public/ (the Vercel output directory); lib/ stays server-only.
const root=path.join(path.dirname(fileURLToPath(import.meta.url)),'public');
const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml','.png':'image/png'};
const port=Number(process.env.PORT||3000);
http.createServer(async(req,res)=>{
  const url=new URL(req.url,'http://localhost');
  if(url.pathname==='/api/game'||url.pathname==='/api/qr'){
    req.query=Object.fromEntries(url.searchParams);req.body={};
    try{if(req.method==='POST'){let raw='';for await(const chunk of req){raw+=chunk;if(raw.length>20000)throw Error('Too large');}req.body=JSON.parse(raw||'{}');}
      await (url.pathname==='/api/game'?game:qr)(req,res);
    }catch(e){res.writeHead(400);res.end(JSON.stringify({ok:false,error:e.message}));}
    return;
  }
  const page=url.pathname==='/'?'index.html':decodeURIComponent(url.pathname.replace(/^\//,''));
  if(page.startsWith('.')||page.includes('..')||!(page.endsWith('.html')||page.startsWith('assets/'))){res.writeHead(404);return res.end('Not found');}
  try{const data=await fs.readFile(path.join(root,page));res.writeHead(200,{'Content-Type':mime[path.extname(page)]||'application/octet-stream'});res.end(data);}catch{res.writeHead(404);res.end('Not found');}
}).listen(port,'0.0.0.0',()=>{
 console.log(`\nBANK BATTLE LIVE — http://localhost:${port}`);
 for(const nets of Object.values(os.networkInterfaces())) for(const n of nets||[]) if(n.family==='IPv4'&&!n.internal) console.log(`Для телефонов в Wi-Fi: http://${n.address}:${port}`);
});
