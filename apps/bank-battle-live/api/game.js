import {randomBytes,randomInt,createHash,timingSafeEqual} from 'node:crypto';
import {redis,hObject,isReady} from '../lib/store.js';
import {TEAMS,ROUNDS,QUESTIONS,COUNT_PER_ROUND,STAKES} from '../lib/questions.js';

const TTL=60*60*24;const MAX=90;
const hash=s=>createHash('sha256').update(s).digest('hex');
// Fingerprint of the question bank: lets the host confirm which version is deployed.
const BANK_ID=hash(JSON.stringify(QUESTIONS)).slice(0,12);
const randomToken=()=>randomBytes(24).toString('hex');
const codeValid=s=>/^\d{6}$/.test(String(s||''));
const codeKey=c=>`bbl:v1:${c}`;
const json=(res,status,obj)=>{res.statusCode=status;res.setHeader('Content-Type','application/json; charset=utf-8');res.setHeader('Cache-Control','no-store, no-cache, max-age=0');res.end(JSON.stringify(obj));};
const err=(msg,status=400)=>{const e=new Error(msg);e.status=status;throw e;};
const safeEq=(a,b)=>{try{return timingSafeEqual(Buffer.from(String(a),'hex'),Buffer.from(String(b),'hex'));}catch{return false;}};
async function getRoom(code){if(!codeValid(code))err('Введите корректный шестизначный код.',400);const v=await redis('GET',codeKey(code)+':meta');if(!v)err('Игровая комната не найдена или истёк срок её действия.',404);return JSON.parse(v);}
async function putRoom(meta){await redis('SET',codeKey(meta.code)+':meta',JSON.stringify(meta),'EX',TTL);}
async function players(code){const entries=hObject(await redis('HGETALL',codeKey(code)+':players'));return Object.entries(entries).map(([id,val])=>({id,...JSON.parse(val)})).sort((a,b)=>a.joinSeq-b.joinSeq);}
async function votes(code,index){const entries=hObject(await redis('HGETALL',codeKey(code)+':votes:'+index));return Object.entries(entries).map(([id,val])=>({id,...JSON.parse(val)}));}
async function hasHost(meta,token){return !!token && safeEq(hash(token),meta.hostHash);}
async function withLock(code,callback){const key=codeKey(code)+':hostlock'; const token=randomToken();const acquired=await redis('SET',key,token,'NX','PX',8000);if(acquired!=='OK')err('Другое действие ведущего выполняется. Повторите через секунду.',409);try{return await callback();}finally{try{if(await redis('GET',key)===token)await redis('DEL',key);}catch{/* the lock expires on its own (PX 8000) */}}}
const publicPerson=(p,sc)=>({id:p.id,name:p.name,team:p.team,score:sc||0});
function currentQuestion(meta){return QUESTIONS[meta.questionIndex]||null;}
function winner(scores){const max=Math.max(...scores);return TEAMS.map((_,i)=>i).filter(i=>scores[i]===max);}
function startQuestion(meta,index){meta.questionIndex=index;meta.status='question';meta.startAt=Date.now()+2300;meta.endAt=meta.startAt+ROUNDS[QUESTIONS[index].round].time*1000;meta.lastReveal=null;}
function roundProgress(meta){return Math.floor(meta.questionIndex/COUNT_PER_ROUND);}

function makeState(meta,ps,vs,token){
 const host=Boolean(token&&safeEq(hash(token),meta.hostHash));
 const mine=ps.find(p=>token&&safeEq(hash(token),p.tokenHash));
 const q=currentQuestion(meta);
 const joined=ps.map(p=>publicPerson(p,meta.personalScores[p.id]||0));
 const scores=meta.teamScores||[0,0,0];
 const state={ok:true,serverNow:Date.now(),code:meta.code,status:meta.status,host,player:mine?publicPerson(mine,meta.personalScores[mine.id]||0):null,
  teams:TEAMS,rounds:ROUNDS.map(({title,subtitle,icon,time,kind})=>({title,subtitle,icon,time,kind})),
  players:joined,teamScores:scores,questionIndex:meta.questionIndex,roundIndex:Math.max(0,roundProgress(meta)),
  totalQuestions:QUESTIONS.length,answeredCount:vs.length,connectedCount:ps.length,
  didAnswer:mine?vs.some(v=>v.id===mine.id):false,
  myVote:mine?vs.find(v=>v.id===mine.id)?.choice??null:null,
  startAt:meta.startAt||0,endAt:meta.endAt||0,history:meta.history||[],lastReveal:meta.lastReveal||null,
  winner:meta.status==='finished'?winner(scores):null};
 if(q&&meta.status!=='lobby'){
   state.question={text:q.text,options:q.options,round:q.round,bonus:!!q.bonus,kind:ROUNDS[q.round].kind,
    source:q.source,base:ROUNDS[q.round].base,stakes:ROUNDS[q.round].kind==='risk'?STAKES:undefined};
   if(meta.status==='reveal'||meta.status==='finished'){
      state.question.correct=q.correct;state.question.explanation=q.explanation;
   }
 }
 if(host){state.canControl=true;}
 return state;
}
async function reveal(meta,ps){
 const index=meta.questionIndex;const q=QUESTIONS[index];const found=await votes(meta.code,index);
 const byId=Object.fromEntries(found.map(v=>[v.id,v]));
 const gains=[0,0,0], totals=[0,0,0];const optCounts=[0,0,0,0];let correctCount=0,answered=0;
 for(const p of ps){
   totals[p.team]++;
   const v=byId[p.id];if(!v)continue;
   answered++;if(v.choice>=0&&v.choice<4)optCounts[v.choice]++;
   let pts=0;
   if(v.choice===q.correct){
     correctCount++;
     if(ROUNDS[q.round].kind==='risk') pts=v.stake;
     else { const fraction=Math.max(0,Math.min(1,(meta.endAt-v.at)/(meta.endAt-meta.startAt)));pts=ROUNDS[q.round].base+Math.round(50*fraction);if(q.bonus)pts*=2; }
   }else if(ROUNDS[q.round].kind==='risk') pts=-v.stake;
   gains[p.team]+=pts;meta.personalScores[p.id]=(meta.personalScores[p.id]||0)+pts;
 }
 const increments=gains.map((v,i)=>totals[i]?Math.round(v/totals[i]):0);
 meta.teamScores=meta.teamScores.map((v,i)=>v+increments[i]);
 const row={index,round:q.round,teamGains:increments,optionCounts:optCounts,correctCount,answered,total:ps.length,correct:q.correct,bonus:!!q.bonus};
 meta.history.push(row);meta.lastReveal=row;meta.status='reveal';meta.revealedAt=Date.now();
 return row;
}
export default async function handler(req,res){
 try{
   const method=(req.method||'GET').toUpperCase();
   if(method==='OPTIONS'){res.setHeader('Allow','GET, POST, OPTIONS');return json(res,200,{ok:true});}
   const data=method==='POST'?(req.body||{}):(req.query||{});
   const op=String(data.op||'state');
   if(op==='health')return json(res,200,{ok:true,configured:isReady(),mode:process.env.LOCAL_DEMO==='1'?'LOCAL':'VERCEL',questions:QUESTIONS.length,bank:BANK_ID,message:isReady()?'Сервер готов':'Подключите Upstash Redis в Vercel → Storage и выполните Redeploy.'});
   if(!isReady())err('Онлайн-синхронизация не настроена. Подключите Upstash Redis к проекту Vercel и выполните Redeploy.',503);
   if(op==='create'){
     if(method!=='POST')err('Используйте POST',405);
     for(let i=0;i<16;i++){
       const code=String(randomInt(100000,1000000));const token=randomToken();
       const meta={code,hostHash:hash(token),status:'lobby',createdAt:Date.now(),questionIndex:0,
         teamScores:[0,0,0],personalScores:{},history:[],lastReveal:null,startAt:0,endAt:0};
       const saved=await redis('SET',codeKey(code)+':meta',JSON.stringify(meta),'NX','EX',TTL);
       if(saved==='OK')return json(res,200,{ok:true,code,token});
     }err('Не удалось создать комнату. Попробуйте ещё раз.',503);
   }
   const code=String(data.code||data.room||'').trim();
   const token=String(req.headers?.['x-game-token']||data.token||'');
   let meta=await getRoom(code);
   if(op==='join'){
     if(method!=='POST')err('Используйте POST',405);
     if(meta.status!=='lobby')err('Игра уже началась. Подключиться можно только до первого вопроса.',409);
     const name=String(data.name||'').trim().replace(/\s+/g,' ').slice(0,26).replace(/[<>]/g,'');
     if(name.length<2)err('Укажите имя минимум из двух символов.');
     const ps=await players(code);if(ps.length>=MAX)err('Достигнут лимит в 90 игроков.',409);
     const nameKey=name.toLocaleLowerCase('ru-RU');const id=randomBytes(10).toString('hex'),playerToken=randomToken();
     const reserved=await redis('HSETNX',codeKey(code)+':names',nameKey,id);
     if(reserved!==1)err('Это имя уже занято. Добавьте фамилию или номер.',409);
     const seq=await redis('INCR',codeKey(code)+':seq'); const team=(seq-1)%3;
     await redis('HSET',codeKey(code)+':players',id,JSON.stringify({id,name,team,joinSeq:seq,tokenHash:hash(playerToken)}));
     await redis('EXPIRE',codeKey(code)+':players',TTL);await redis('EXPIRE',codeKey(code)+':names',TTL);await redis('EXPIRE',codeKey(code)+':seq',TTL);
     return json(res,200,{ok:true,code,token:playerToken,player:{id,name,team}});
   }
   if(op==='state'){
     const ps=await players(code);
     // Votes are needed after the reveal too, so each player still sees their own answer.
     const vs=meta.status==='question'||meta.status==='reveal'?await votes(code,meta.questionIndex):[];
     return json(res,200,makeState(meta,ps,vs,token));
   }
   if(op==='answer'){
     if(method!=='POST')err('Используйте POST',405);
     if(meta.status!=='question')err('Сейчас приём ответов закрыт.',409);
     const now=Date.now();if(now<meta.startAt)err('Дождитесь начала вопроса.',409);
     if(now>meta.endAt)err('Время на ответ истекло.',409);
     const ps=await players(code);const me=ps.find(p=>token&&safeEq(hash(token),p.tokenHash));if(!me)err('Участник не найден. Вернитесь к подключению.',401);
     const choice=Number(data.choice);if(!Number.isInteger(choice)||choice<0||choice>3)err('Выберите один из вариантов.');
     const q=currentQuestion(meta);const stake=ROUNDS[q.round].kind==='risk'?Number(data.stake):0;
     if(ROUNDS[q.round].kind==='risk'&&!STAKES.includes(stake))err('Выберите допустимую ставку.');
     const saved=await redis('HSETNX',codeKey(code)+':votes:'+meta.questionIndex,me.id,JSON.stringify({choice,stake,at:now}));
     if(saved!==1)err('Ваш ответ уже принят. Изменять его нельзя.',409);
     await redis('EXPIRE',codeKey(code)+':votes:'+meta.questionIndex,TTL);
     return json(res,200,{ok:true,accepted:true});
   }
   if(op==='control'){
     if(method!=='POST')err('Используйте POST',405);
     if(!await hasHost(meta,token))err('Действие доступно только ведущему.',403);
     const action=String(data.action||'');
     return await withLock(code,async()=>{
       meta=await getRoom(code);
       const ps=await players(code);
       if(action==='start'){
         if(meta.status!=='lobby')err('Игра уже началась.',409);
         if(ps.length<3)err('Для старта нужны минимум 3 участника.',409);
         if(new Set(ps.map(p=>p.team)).size!==3)err('Должны присутствовать все три команды.',409);
         startQuestion(meta,0);
       }else if(action==='reveal'){
         if(meta.status!=='question')err('Сейчас нечего раскрывать.',409);
         await reveal(meta,ps);
       }else if(action==='next'){
         if(meta.status!=='reveal')err('Сначала откройте правильный ответ.',409);
         if(meta.questionIndex===QUESTIONS.length-1){meta.status='finished';meta.finishedAt=Date.now();}
         else startQuestion(meta,meta.questionIndex+1);
       }else if(action==='finish'){
         if(meta.status!=='reveal'||meta.questionIndex!==QUESTIONS.length-1)err('Финал доступен после последнего вопроса.',409);
         meta.status='finished';meta.finishedAt=Date.now();
       }else err('Неизвестная команда управления.');
       await putRoom(meta);return json(res,200,{ok:true,status:meta.status});
     });
   }
   err('Неизвестный запрос.',404);
 }catch(e){return json(res,e.status||500,{ok:false,error:(e.status&&e.status<500)||e.status===503||e.status===504?e.message:'Ошибка сервера. Проверьте параметры базы и попробуйте снова.'});}
}
