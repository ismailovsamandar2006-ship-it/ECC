// Serverless persistence: Upstash Redis REST (shared between all Vercel instances).
// LOCAL_DEMO=1 is intentionally limited to one local Node process; never used on Vercel.
const mem = new Map();
const until = new Map();
function memory(command) {
  const [raw,...a] = command;
  const op = raw.toUpperCase(); const key = String(a[0]);
  if (until.has(key) && until.get(key) < Date.now()) { mem.delete(key); until.delete(key); }
  if (op === 'PING') return 'PONG';
  if (op === 'GET') return mem.get(key) ?? null;
  if (op === 'SET') {
    const mode=a.map(String).map(x=>x.toUpperCase());
    if (mode.includes('NX') && mem.has(key)) return null;
    mem.set(key,String(a[1]));
    const ex=mode.indexOf('EX'), px=mode.indexOf('PX');
    if (ex>=0) until.set(key,Date.now()+Number(a[ex+1])*1000);
    else if (px>=0) until.set(key,Date.now()+Number(a[px+1]));
    return 'OK';
  }
  if (op==='DEL') {const v=mem.delete(key);until.delete(key);return Number(v);}
  if(op==='HGETALL') {const h=mem.get(key);return h ? [...h.entries()].flat() : [];}
  if(op==='HGET') return mem.get(key)?.get(String(a[1])) ?? null;
  if(op==='HSET' || op==='HSETNX') {
    let h=mem.get(key); if(!h){h=new Map();mem.set(key,h);}
    const field=String(a[1]);if(op==='HSETNX'&&h.has(field))return 0;
    const was=h.has(field);h.set(field,String(a[2]));return was?0:1;
  }
  if(op==='INCR') {const n=Number(mem.get(key)||0)+1;mem.set(key,String(n));return n;}
  if(op==='EXPIRE') {until.set(key,Date.now()+Number(a[1])*1000);return 1;}
  throw Error('Unsupported local store command: '+op);
}
// Credentials: a manually created Upstash database uses UPSTASH_REDIS_REST_URL/_TOKEN;
// Vercel Marketplace (Upstash for Redis) injects <PREFIX>_REST_API_URL/_TOKEN, where the
// prefix is KV by default but can be renamed in the connect dialog.
function credentials() {
  const env = process.env;
  if (env.UPSTASH_REDIS_REST_URL && env.UPSTASH_REDIS_REST_TOKEN) return [env.UPSTASH_REDIS_REST_URL, env.UPSTASH_REDIS_REST_TOKEN];
  if (env.KV_REST_API_URL && env.KV_REST_API_TOKEN) return [env.KV_REST_API_URL, env.KV_REST_API_TOKEN];
  for (const key of Object.keys(env).sort()) {
    if (!key.endsWith('_REST_API_URL')) continue;
    const token = env[key.slice(0, -'_URL'.length) + '_TOKEN'];
    if (env[key] && token) return [env[key], token];
  }
  return ['', ''];
}
const restUrl = () => credentials()[0];
const restToken = () => credentials()[1];
export const isReady = () => process.env.LOCAL_DEMO==='1' || Boolean(restUrl() && restToken());
export async function redis(...command) {
  if(process.env.LOCAL_DEMO==='1') return memory(command);
  if(!isReady()) {const e=new Error('Не подключена база Upstash Redis. Подключите её в Vercel → Storage (переменные KV_REST_API_URL/KV_REST_API_TOKEN или UPSTASH_REDIS_REST_URL/UPSTASH_REDIS_REST_TOKEN), затем Redeploy.');e.status=503;throw e;}
  const endpoint=restUrl().replace(/\/$/,'');
  const ctl=new AbortController();const timeout=setTimeout(()=>ctl.abort(),6500);
  try {
    const r=await fetch(endpoint,{method:'POST',headers:{Authorization:'Bearer '+restToken(),'Content-Type':'application/json'},body:JSON.stringify(command),signal:ctl.signal});
    const j=await r.json().catch(()=>({error:'Некорректный ответ базы данных'}));
    if(!r.ok||j.error){const e=new Error('Ошибка Redis: '+(j.error||r.status));e.status=502;throw e;}
    return j.result;
  } catch(e) {
    if(e.name==='AbortError'){const err=new Error('Сервер базы данных не ответил. Повторите попытку.');err.status=504;throw err;}
    throw e;
  } finally {clearTimeout(timeout);}
}
export const hObject = (arr)=> {
  if(!arr) return {};
  if(!Array.isArray(arr)) return arr;
  const out={}; for(let i=0;i<arr.length;i+=2)out[arr[i]]=arr[i+1];return out;
};
