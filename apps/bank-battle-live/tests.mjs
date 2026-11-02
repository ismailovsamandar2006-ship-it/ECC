import assert from 'node:assert/strict';
import handler from './api/game.js';
import {redis} from './lib/store.js';
import {QUESTIONS} from './lib/questions.js';
process.env.LOCAL_DEMO='1';
const api=async (op,data={},token='')=>{
 const req={method:op==='state'?'GET':'POST',query:{op,code:data.code},body:{op,...data},headers:{'x-game-token':token}};
 const res={headers:{},statusCode:200,setHeader(k,v){this.headers[k]=v;},end(b){this.json=JSON.parse(b);}};
 await handler(req,res);return {...res.json,httpStatus:res.statusCode};
};
const created=await api('create');assert(created.ok&&created.code);
const c=created.code;const h=created.token;
const joined=await Promise.all(['Лейла','Азиз','Малика'].map(name=>api('join',{code:c,name})));
assert.deepEqual(joined.map(x=>x.player.team),[0,1,2]);
assert.equal((await api('join',{code:c,name:'Азиз'})).httpStatus,409);
assert.equal((await api('control',{code:c,action:'start'},h)).httpStatus,200);
assert.equal((await api('join',{code:c,name:'Поздний'})).httpStatus,409);
assert.equal((await api('state',{code:c})).question.correct,undefined,'Correct answer must be hidden');
assert.equal((await api('control',{code:c,action:'reveal'},'bad-token')).httpStatus,403);
for(let i=0;i<QUESTIONS.length;i++){
 const key=`bbl:v1:${c}:meta`;const meta=JSON.parse(await redis('GET',key));
 assert.equal(meta.questionIndex,i);
 // emulate the question starting in past without a 2.3-second delay per test
 meta.startAt=Date.now()-1000;meta.endAt=Date.now()+20000;
 await redis('SET',key,JSON.stringify(meta),'EX',86400);
 if(i===0){
   const good=await api('answer',{code:c,choice:QUESTIONS[i].correct},joined[0].token);assert(good.ok);
   const repeat=await api('answer',{code:c,choice:QUESTIONS[i].correct},joined[0].token);assert.equal(repeat.httpStatus,409);
   const bad=await api('answer',{code:c,choice:(QUESTIONS[i].correct+1)%4},joined[1].token);assert(bad.ok);
 } else if(i===QUESTIONS.length-1){
   const riskGood=await api('answer',{code:c,choice:QUESTIONS[i].correct,stake:200},joined[0].token);assert(riskGood.ok);
   const riskBad=await api('answer',{code:c,choice:(QUESTIONS[i].correct+1)%4,stake:100},joined[1].token);assert(riskBad.ok);
   const riskInvalid=await api('answer',{code:c,choice:QUESTIONS[i].correct,stake:555},joined[2].token);assert.equal(riskInvalid.httpStatus,400);
 }
 const revealed=await api('control',{code:c,action:'reveal'},h);assert.equal(revealed.httpStatus,200);
 const publicState=await api('state',{code:c});assert.equal(publicState.question.correct,QUESTIONS[i].correct);
 if(i===0){
   const mineAfter=await api('state',{code:c},joined[0].token);
   assert.equal(mineAfter.myVote,QUESTIONS[i].correct,'Player must still see own answer after reveal');
   assert.equal(mineAfter.didAnswer,true);
   const silent=await api('state',{code:c},joined[2].token);assert.equal(silent.myVote,null);
 }
 assert.equal(publicState.history.length,i+1);
 const advanced=await api('control',{code:c,action:'next'},h);assert.equal(advanced.httpStatus,200);
}
const final=await api('state',{code:c});assert.equal(final.status,'finished');assert.equal(final.history.length,30);
assert.deepEqual(final.teamScores.length,3);assert(final.winner.includes(0));
assert(final.teamScores[1]<0,'Risk-incorrect player/team should have a loss');
console.log('\u{2705} create • join • 3 teams • host auth • private answers • 30 questions • one-vote rule • risk • final scoreboard • winner');
console.log('Final team scores:',final.teamScores,'Winner:',final.winner);
