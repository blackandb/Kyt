const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const cache = new Map();
const overrides = new Map();
function load(file) {
  file = path.resolve(file);
  if (cache.has(file)) return cache.get(file).exports;
  const module = { exports: {} }; cache.set(file,module);
  const js = ts.transpileModule(fs.readFileSync(file,'utf8'), { compilerOptions: {
    target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS
  }}).outputText;
  const req = name => overrides.has(name) ? overrides.get(name) : name === 'server-only' ? {} : name.startsWith('@/') ? load('src/' + name.slice(2) + '.ts') : require(name);
  new Function('require','module','exports',js)(req,module,module.exports);
  return module.exports;
}
const model = load('src/lib/audit-model.ts');
const main = 'TR8KXE6EZQCDoVFEEZHGsHYr81nAZMvwcr';
const peer = 'TUYf6f3mojtiXPYXTy6nXDvmsGkDd55XUG';
function state() { return { kind:'full-audit',version:1,revision:0,address:main,phase:'done',startedAt:'',updatedAt:'',
  before:12345,since:0,cursor:null,pages:0,trc20Rows:0,nativeRows:0,peers:[],targetStatus:'clear',
  targetSanctioned:false,targetFlagged:false,targetCheckedAt:'',balances:{usdt:'0',trx:'0'},
  sanctionsUpdatedAt:null,lastError:null,verificationPass:0 }; }
test('Never approves a blocked target, even without counterparties',()=>{
  const a=state();a.targetStatus='blocked';assert.equal(model.auditVerdict(a),'BLOCKED');
});
test('Pending, unavailable blacklist or unavailable balances never return OK',()=>{
  for (const alter of [a=>a.phase='native', a=>a.targetStatus='unknown', a=>a.balances=null,
    a=>model.peerFor(a,peer), a=>model.peerFor(a,peer).status='unknown']) {
    const a=state();alter(a);assert.equal(model.auditVerdict(a),'INCOMPLETE');
  }
});
test('Only a finished, fully verified scan returns scoped OK',()=>{
  const a=state();model.peerFor(a,peer).status='clear';assert.equal(model.auditVerdict(a),'OK');
});
test('Outgoing-only blacklist contact is not missed',()=>{
  const a=state();model.recordTransfer(a,{from:main,to:peer,raw:'61000000000',token:'USDT',decimals:6,hash:'h',at:1});
  a.peers[0].status='blocked';
  assert.equal(model.auditVerdict(a),'NOT_OK');assert.equal(a.peers[0].outgoingUsdt,'61000000000');
  assert.equal(a.peers[0].incomingUsdt,'0');
});
test('Directions and integer amounts are preserved beyond floating-point precision',()=>{
  const a=state();
  for (const raw of ['900719925474099312345','1'])
    model.recordTransfer(a,{from:peer,to:main,raw,token:'USDT',decimals:6,hash:raw,at:1});
  assert.equal(a.peers[0].incomingUsdt,'900719925474099312346');
  assert.equal(model.units(a.peers[0].incomingUsdt),'900719925474099.312346');
});
test('Zero-value contact remains visible without claiming a positive payment',()=>{
  const a=state();model.recordTransfer(a,{from:peer,to:main,raw:'0',token:'USDT',decimals:6,hash:'z',at:1});
  a.peers[0].status='blocked';assert.equal(a.peers[0].positiveTransfers,0);
  assert.equal(model.auditVerdict(a),'NOT_OK');
});
test('Evidence is bounded but aggregates include every payment',()=>{
  const a=state();for(let i=0;i<30;i++)model.recordTransfer(a,{from:peer,to:main,raw:'1000000',token:'USDT',decimals:6,hash:String(i),at:i});
  assert.equal(a.peers[0].evidence.length,20);assert.equal(a.peers[0].transfers,30);
  assert.equal(a.peers[0].incomingUsdt,'30000000');
});
test('Malformed amounts fail rather than silently truncating history',()=>{
  assert.throws(()=>model.recordTransfer(state(),{from:peer,to:main,raw:'1.2',token:'USDT',decimals:6,hash:'',at:0}));
});
test('Own-wallet status cannot bypass a live freeze in the legacy scorer',()=>{
  const {scoreAddress}=load('src/lib/risk.ts');
  const a={address:main,valid:true,tetherBlacklisted:true,sanctioned:false,flagged:null,createdAt:1,
    activated:true,trc20Count:100,isOwnWallet:true,poisoningOf:null,trace:null};
  assert.equal(scoreAddress(a).passed,false);assert.equal(scoreAddress(a).score,100);
  a.tetherBlacklisted=null;assert.equal(scoreAddress(a).passed,false);
});
test('Blacklist result accepts only explicit successful ABI booleans',async()=>{
  const {readBlacklist}=load('src/lib/audit.ts');
  const original=global.fetch;
  try {
    for (const [body,want] of [
      [{result:{result:true},constant_result:['0'.repeat(63)+'1']},'blocked'],
      [{result:{result:true},constant_result:['0'.repeat(64)]},'clear'],
      [{result:{result:false},constant_result:['0'.repeat(64)]},'unknown'],
      [{result:{result:true},constant_result:['0'.repeat(63)+'2']},'unknown']
    ]) {global.fetch=async()=>Response.json(body);assert.equal(await readBlacklist(main),want);}
  } finally {global.fetch=original;}
});
test('Pagination keeps timestamp bounds, screens outgoing transfers and consumes the last page',async()=>{
  const {readHistoryPage}=load('src/lib/audit.ts');
  const original=global.fetch;const a=state();a.phase='trc20';
  let calls=0;
  try {
    global.fetch=async(url)=>{
      const u=new URL(url);assert.equal(u.searchParams.get('max_timestamp'),'12345');
      assert.equal(u.searchParams.has('only_to'),false);
      if(calls++===0)return Response.json({success:true,data:[{type:'Transfer',from:main,to:peer,value:'61000000000',
        block_timestamp:100,transaction_id:'tx',token_info:{address:'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t',symbol:'USDT',decimals:6}}],
        meta:{links:{next:'https://api.trongrid.io/v1/accounts/'+main+'/transactions/trc20?fingerprint=next'}}});
      assert.equal(u.searchParams.get('fingerprint'),'next');return Response.json({success:true,data:[]});
    };
    await readHistoryPage(a);assert.equal(a.cursor,'next');assert.equal(a.phase,'trc20');
    await readHistoryPage(a);assert.equal(a.phase,'native');assert.equal(a.peers[0].outgoingUsdt,'61000000000');
  }finally{global.fetch=original;}
});
test('Provider errors cannot be presented as empty, completed history',async()=>{
  const {readHistoryPage}=load('src/lib/audit.ts');const original=global.fetch;const a=state();a.phase='trc20';
  try {global.fetch=async()=>Response.json({success:false,data:[]});await assert.rejects(readHistoryPage(a));assert.equal(a.phase,'trc20');}
  finally{global.fetch=original;}
});
test('Pagination rejects untrusted origins and repeated fingerprints',async()=>{
  const {readHistoryPage}=load('src/lib/audit.ts');const original=global.fetch;
  try {
    for(const next of ['https://attacker.example/steal','https://api.trongrid.io/v1/accounts/'+main+'/transactions/trc20?fingerprint=same']){
      const a=state();a.phase='trc20';a.cursor='same';
      global.fetch=async()=>Response.json({success:true,data:[],meta:{links:{next}}});
      await assert.rejects(readHistoryPage(a));assert.equal(a.phase,'trc20');
    }
  }finally{global.fetch=original;}
});

test('Audit route enforces owner isolation, checkpoint rollback and resume',async()=>{
  let user='11111111-1111-4111-8111-111111111111';
  const id='22222222-2222-4222-8222-222222222222';
  const initial=state();initial.phase='trc20';initial.revision=0;
  const rows=[{id,owner_id:user,result:structuredClone(initial)}];
  const database={from(table){
    let op='select',values=null;const filters=[];
    const builder={
      select(){return builder;},eq(key,value){filters.push([key,value]);return builder;},
      update(v){op='update';values=v;return builder;},maybeSingle(){builder.single=true;return builder;},
      then(resolve,reject){
        try {
          if(table!=='manual_checks') return Promise.resolve({data:table==='settings'?null:[],error:null}).then(resolve,reject);
          const matches=rows.filter(r=>filters.every(([key,value])=>key==='result->>revision' ?
            String(r.result.revision)===String(value) : r[key]===value));
          if(op==='update')for(const r of matches)Object.assign(r,structuredClone(values));
          const data=builder.single ? matches[0]||null : matches.map(r=>structuredClone(r));
          return Promise.resolve({data:structuredClone(data),error:null}).then(resolve,reject);
        }catch(e){return Promise.reject(e).then(resolve,reject);}
      }
    };return builder;
  }};
  overrides.set('@/lib/auth',{currentCodeId:async()=>user});
  overrides.set('@/lib/supabase/admin',{db:()=>database});
  let fail=true;
  overrides.set('@/lib/audit',{
    readBlacklist:async()=> 'clear',readBalances:async()=>({usdt:'1',trx:'2'}),
    readHistoryPage:async a=>{
      model.recordTransfer(a,{from:peer,to:main,raw:'1000000',token:'USDT',decimals:6,hash:'one',at:1});
      if(fail)throw new Error('Provider disconnected mid-page');
      a.phase='screen';
    }
  });
  const {POST}=load('src/app/api/audit/route.ts');
  const request=body=>new Request('https://test.invalid/api/audit',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});
  try {
    user=null;assert.equal((await POST(request({id}))).status,401);
    user='33333333-3333-4333-8333-333333333333';assert.equal((await POST(request({id}))).status,404);
    user=rows[0].owner_id;
    const failed=await (await POST(request({id}))).json();
    assert.match(failed.audit.lastError,/disconnected/);assert.equal(failed.audit.peers.length,0);
    assert.equal(failed.audit.phase,'trc20');assert.equal(model.auditVerdict(failed.audit),'INCOMPLETE');
    fail=false;
    const resumed=await (await POST(request({id}))).json();assert.equal(resumed.audit.peers.length,1);
    assert.equal(resumed.audit.peers[0].incomingUsdt,'1000000');
    const screened=await (await POST(request({id}))).json();assert.equal(screened.audit.peers[0].status,'clear');
    const finished=await (await POST(request({id}))).json();assert.equal(finished.audit.phase,'done');
    assert.equal(model.auditVerdict(finished.audit),'OK');
    rows[0].result.phase='screen';rows[0].result.leaseUntil=Date.now()+5000;
    assert.equal((await POST(request({id}))).status,409);
  }finally{overrides.clear();}
});
