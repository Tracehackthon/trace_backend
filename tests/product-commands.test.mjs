import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import { once } from 'node:events';
import { createProductWorkspace } from '../packages/product/workspace/src/workspace.mjs';
import { selectComparisonAnchor, applyProductOperations } from '../packages/product/workspace/src/index.mjs';

async function fixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'trace-product-command-'));
  const file = path.join(directory, 'web.sqlite'); const closers = [];
  t.after(async () => {
    for (const close of closers) await close();
    const absolute = path.resolve(directory);
    assert.equal(path.dirname(absolute), path.resolve(os.tmpdir()));
    assert.ok(path.basename(absolute).startsWith('trace-product-command-'));
    fs.rmSync(absolute, {recursive:true,force:true});
  });
  async function open(allowSnapshotWrites = false) {
    const store = createProductWorkspace({file, allowSnapshotWrites});
    const server = http.createServer(async (req,res) => {if (!await store.handle(req,res)){res.writeHead(404);res.end('{}');}});
    server.listen(0, '127.0.0.1'); await once(server,'listening');
    const origin = `http://127.0.0.1:${server.address().port}`;
    let closed = false, counter = 0;
    const close = async () => {if(closed)return;closed=true;await new Promise(resolve=>server.close(resolve));store.close();};
    closers.push(close);
    async function request(route, method='GET', body, headers={}) {
      const response=await fetch(origin+route,{method,headers:{origin,'content-type':'application/json',...headers},...(body===undefined?{}:{body:typeof body==='string'||Buffer.isBuffer(body)?body:JSON.stringify(body)})});
      const json=await response.json();return {status:response.status,json};
    }
    const read = async () => (await request('/api/product/workspace')).json;
    const envelope=(operations, expectedRevision, commandId=`command-${++counter}`)=>({protocolVersion:1,commandId,expectedRevision,operations:Array.isArray(operations)?operations:[operations]});
    const execute=async(operations, expectedRevision, commandId)=>request('/api/product/commands','POST',envelope(operations,expectedRevision??(await read()).revision,commandId));
    const ok=async ops=>{const result=await execute(ops);assert.equal(result.status,200,JSON.stringify(result));assert.equal(result.json.receipt.status,'committed');return result.json;};
    return {store,request,read,envelope,execute,ok,close};
  }
  return {file,open,...await open()};
}
const capture=(id='m',text='原话🙂：还没有想清楚')=>({type:'capture.create',matterId:id,text});
const chain=(type,extra={},matterId='m')=>({type:'chain.action',matterId,action:{type,...extra}});
const compare=(type,extra={},sessionId='c')=>({type:'comparison.action',sessionId,action:{type,...extra}});
const work=(type,extra={},workId='w')=>({type:'worksite.action',workId,action:{type,...extra}});
const saveUnderstanding=text=>[chain('UNDERSTANDING_DRAFT',{text}),chain('SAVE_UNDERSTANDING')];
const startWork={type:'handoff.create',matterId:'m',workId:'w',destination:{agent:'手工编辑器',project:'本地测试',task:'核对条件'},role:'trial',note:'只在本次试'};

test('product API default is commands-only; both legacy overwrite paths are closed',async t=>{
  const a=await fixture(t);const first=await a.read();
  assert.equal(first.revision,0);assert.equal(first.host,null);assert.equal(first.writeMode,'product-commands');
  assert.equal((await a.request('/api/web/workspace','PUT',{expectedRevision:0,commandId:'old',host:{}})).status,410);
  assert.equal((await a.request('/api/web/reset','POST',{commandId:'old-reset',host:{}})).status,410);
  assert.equal((await a.read()).revision,0);
});

test('capture, explicit understanding and stop restore from the same v1 database after restart',async t=>{
  const a=await fixture(t);
  let state=await a.ok(capture());let m=state.host.chain.matters[0];
  assert.equal(m.id,'m');assert.equal(m.understanding,'');assert.equal(m.understandingVersion,0);
  assert.equal(m.title,'');
  state=await a.ok([...saveUnderstanding('我自己的理解\r\n第二段'),chain('STOP_DRAFT',{text:'还没分清适用条件'}),chain('COLLAPSE')]);
  assert.equal(state.host.chain.matters[0].understandingVersion,1);
  await a.close();const reopened=await a.open();const loaded=await reopened.read();
  assert.equal(loaded.revision,state.revision);assert.deepEqual(loaded.host,state.host);
  assert.equal(loaded.host.chain.matters[0].stop,'还没分清适用条件');
  assert.equal((await reopened.request('/api/web/export')).json.host.chain.matters[0].originalText,'原话🙂：还没有想清楚');
});

test('replay survives later revisions and reopen, returns original receipt, never executes capture twice',async t=>{
  const a=await fixture(t),body=a.envelope(capture(),0,'stable-id');
  const first=await a.request('/api/product/commands','POST',body);assert.equal(first.status,200);
  await a.ok(saveUnderstanding('后来写的理解'));
  const replay=await a.request('/api/product/commands','POST',body);
  assert.deepEqual(replay.json.receipt,first.json.receipt);assert.equal(replay.json.revision,1);assert.equal(replay.json.headRevision,2);
  assert.equal((await a.read()).host.chain.matters[0].understanding,'后来写的理解');
  const different={...body,operations:[capture('m','别的原话')]};
  assert.equal((await a.request('/api/product/commands','POST',different)).json.error.code,'COMMAND_CONFLICT');
  await a.close();const reopened=await a.open();
  const lookup=await reopened.request('/api/product/commands/stable-id');assert.deepEqual(lookup.json.receipt,first.json.receipt);
  assert.equal((await reopened.request('/api/product/commands/missing')).status,404);
});

test('whole batch is atomic when a later domain guard fails; no partial matter or command receipt',async t=>{
  const a=await fixture(t);
  const bad=await a.execute([capture(),chain('SAVE_UNDERSTANDING')],0,'atomic-fail');
  assert.equal(bad.status,422);assert.equal((await a.read()).host,null);
  assert.equal((await a.request('/api/product/commands/atomic-fail')).status,404);
  assert.equal((await a.execute(capture(),0,'atomic-fail')).status,200);
});

test('two service handles serialize CAS and stale reset cannot erase a newer write',async t=>{
  const a=await fixture(t),b=await a.open();
  await a.ok(capture());
  const failed=await b.execute(capture('other'),0,'writer-b');
  assert.equal(failed.status,409);assert.equal(failed.json.error.code,'REVISION_CONFLICT');
  assert.equal((await b.execute({type:'workspace.reset',mode:'empty',confirm:'replace-current-workspace'},0,'stale-reset')).status,409);
  assert.equal((await b.read()).host.chain.matters.length,1);
});

test('envelope and action allowlists reject host state, forged receipts, broad scopes and unknown actions',async t=>{
  const a=await fixture(t);await a.ok(capture());
  const badOperations=[
    {...capture('x'),host:{chain:{}}},
    chain('COMMIT_REVISION'),chain('SAVE_UNDERSTANDING',{approved:true}),
    chain('HANDOFF_DRAFT',{patch:{scope:'team'}}),
    compare('COMMIT_RESULT',{ok:true,receipt:{}}),work('CONFIRM_REVISION',{receipt:{version:2}}),
    {type:'workspace.reset',mode:'empty',confirm:'yes'},
    {type:'impact.record',stage:'usage',verified:true},
  ];
  for(const op of badOperations)assert.equal((await a.execute(op)).status,422,JSON.stringify(op));
  const body={...a.envelope(capture('x'),1),host:{}};
  assert.equal((await a.request('/api/product/commands','POST',body)).status,400);
  assert.equal((await a.read()).revision,1);
});

test('suggestions stay in draft, exact Unicode range is protected and stale acceptance is rejected',async t=>{
  const a=await fixture(t);await a.ok([capture(),...saveUnderstanding('原话🙂\r\n用户后来补写。')]);
  assert.equal((await a.execute(chain('SUGGEST',{start:3,end:4,replacement:'坏范围'}))).status,422);
  await a.ok(chain('SUGGEST',{start:0,end:2,replacement:'限定'}));
  await a.ok(chain('ACCEPT_SUGGESTION'));
  let m=(await a.read()).host.chain.matters[0];assert.equal(m.understanding,'原话🙂\r\n用户后来补写。');
  assert.equal(m.understandingDraft,'限定🙂\r\n用户后来补写。');
  await a.ok(chain('SAVE_UNDERSTANDING'));
  await a.ok(chain('SUGGEST',{start:0,end:2,replacement:'另一解释'}));
  await a.ok(chain('UNDERSTANDING_DRAFT',{text:'更晚的个人编辑'}));
  assert.equal((await a.execute(chain('ACCEPT_SUGGESTION'))).status,409);
  assert.equal((await a.read()).host.chain.matters[0].understandingDraft,'更晚的个人编辑');
});

test('comparison LINK creates only a relationship and server-issued receipt, persisted atomically',async t=>{
  const a=await fixture(t);const initial=await a.ok(capture());
  const anchor=selectComparisonAnchor(initial.host,'m',{field:'originalText'});
  await a.ok({type:'comparison.open',matterId:'m',sessionId:'c',anchor,returnTarget:{view:'chain',matterId:'m',screen:'discussion',anchor}});
  await a.ok(compare('IMPORT_MATERIAL',{material:{title:'用户提供的材料',excerpt:'某些条件下并不成立',context:'只是一种条件',url:null}}));
  const state=await a.ok(compare('LINK'));
  assert.equal(state.host.chain.matters[0].links.length,1);assert.equal(state.host.chain.matters[0].understandingVersion,0);
  assert.equal(state.host.comparisons.c.model.request,null);assert.ok(state.host.comparisons.c.model.receipt);
  const returned=await a.ok({type:'comparison.return',sessionId:'c'});assert.equal(returned.host.chain.selectedId,'m');
});

test('a selected Zhihu result keeps provider provenance and URL through import, link and restart',async t=>{
  const a=await fixture(t);const initial=await a.ok(capture());
  const anchor=selectComparisonAnchor(initial.host,'m',{field:'originalText'});
  await a.ok({type:'comparison.open',matterId:'m',sessionId:'external-c',anchor});
  const material={id:'external:zhihu-1',provider:'zhihu',source:'zhihu',title:'真实经验摘要',author:'知乎作者',
    url:'https://www.zhihu.com/question/1/answer/2',excerpt:'这段是接口返回的摘要，不是全文。',sourceType:'知乎公开内容',
    contentType:'answer',contentMode:'summary',fetchedAt:'2026-09-15T00:00:00.000Z'};
  await a.ok(compare('IMPORT_MATERIAL',{material},'external-c'));
  let state=await a.ok(compare('LINK',{},'external-c'));
  const source=state.host.chain.sources.find(item=>item.id===material.id);
  assert.deepEqual({provider:source.provider,source:source.source,author:source.author,url:source.url,contentMode:source.contentMode},
    {provider:'zhihu',source:'zhihu',author:'知乎作者',url:material.url,contentMode:'summary'});
  assert.equal(state.host.chain.matters[0].links[0].source.url,material.url);
  await a.close();const reopened=await a.open();state=await reopened.read();
  assert.equal(state.host.chain.sources.find(item=>item.id===material.id).fetchedAt,material.fetchedAt);
  const bad=await reopened.execute([{type:'comparison.open',matterId:'m',sessionId:'bad-url',anchor},
    compare('IMPORT_MATERIAL',{material:{...material,id:'external:bad',url:'javascript:alert(1)'}},'bad-url')]);
  assert.equal(bad.status,422);
});

test('comparison revision is server-evaluated and an old comparison cannot overwrite later understanding',async t=>{
  const a=await fixture(t);const initial=await a.ok([capture(),...saveUnderstanding('原来的句子。\n另一段')]);
  const anchor=selectComparisonAnchor(initial.host,'m',{field:'understanding',start:0,end:6});
  await a.ok({type:'comparison.open',matterId:'m',sessionId:'c',anchor});
  await a.ok(compare('IMPORT_MATERIAL',{material:{excerpt:'这是一个限制条件'}}));
  await a.ok([compare('OPEN_REVISION'),compare('REVISION_DRAFT',{text:'增加条件的句子。'})]);
  await a.ok(saveUnderstanding('用户后来写的新版本。\n另一段'));
  assert.equal((await a.execute(compare('CONFIRM_REVISION'))).status,409);
  assert.equal((await a.read()).host.chain.matters[0].understanding,'用户后来写的新版本。\n另一段');
});

test('work snapshots, result-only, confirmed revision and undo retain evidence and old intake',async t=>{
  const a=await fixture(t);await a.ok([capture(),...saveUnderstanding('工作带出的 v1'),startWork]);
  await a.ok(saveUnderstanding('工作之后补写的 v2'));
  await a.ok(work('RESULT_DRAFT',{patch:{fact:'实际观察：部分条件不成立',interpretation:'我的解释',unconfirmed:'未验证其他条件',proposedUnderstanding:'基于 v2 修改的 v3'}}));
  let state=await a.ok(work('KEEP_RESULT_ONLY'));
  assert.equal(state.host.chain.matters[0].understandingVersion,2);assert.equal(state.host.worksite.sessions.w.results.length,1);
  assert.equal((await a.execute(work('CONFIRM_REVISION'))).status,422);
  await a.ok(work('OPEN_REVISION_REVIEW'));state=await a.ok(work('CONFIRM_REVISION'));
  assert.equal(state.host.chain.matters[0].understandingVersion,3);assert.equal(state.host.worksite.sessions.w.intake[0].sourceVersion,1);
  assert.equal(state.host.worksite.works.w.connected,false);
  state=await a.ok(work('UNDO_REVISION'));
  assert.equal(state.host.chain.matters[0].understanding,'工作之后补写的 v2');assert.equal(state.host.chain.matters[0].understandingVersion,4);
  assert.ok(state.host.worksite.sessions.w.results.some(r=>r.fact==='实际观察：部分条件不成立'));
});

test('a result cannot silently target a different matter; later drafts prevent reviewed overwrites',async t=>{
  const a=await fixture(t);await a.ok([capture(),...saveUnderstanding('v1'),startWork,capture('other')]);
  assert.equal((await a.execute(work('RESULT_DRAFT',{patch:{matterId:'other',fact:'错目标'}}))).status,422);
  await a.ok([work('RESULT_DRAFT',{patch:{fact:'事实',proposedUnderstanding:'拟修改'}}),work('OPEN_REVISION_REVIEW')]);
  await a.ok(chain('UNDERSTANDING_DRAFT',{text:'正在写、还没提交'}));
  assert.equal((await a.execute(work('CONFIRM_REVISION'))).status,409);
  assert.equal((await a.read()).host.chain.matters.find(m=>m.id==='m').understandingDraft,'正在写、还没提交');
});

test('preset reset uses current CAS, independent confirmation, complete sessions and marked examples',async t=>{
  const a=await fixture(t);await a.ok(capture());
  assert.equal((await a.execute([{type:'workspace.reset',mode:'demo',confirm:'replace-current-workspace'},capture('x')])).status,422);
  const state=await a.ok({type:'workspace.reset',mode:'demo',confirm:'replace-current-workspace'});
  assert.equal(state.host.chain.matters.length,3);assert.ok(state.host.chain.matters.every(m=>m.origin==='demo'));
  assert.ok(state.host.chain.matters.every(m=>Array.isArray(state.host.chain.sessions[m.id].handoffHistory)));
  const reset=await a.ok({type:'workspace.reset',mode:'empty',confirm:'replace-current-workspace'});
  assert.equal(reset.host.chain.matters.length,0);assert.equal(reset.revision,3);
});

test('same-origin, valid JSON, UTF-8, bounded body and safe object keys are enforced',async t=>{
  const a=await fixture(t),body=a.envelope(capture(),0);
  assert.equal((await a.request('/api/product/commands','POST',body,{origin:'https://different.invalid'})).status,403);
  assert.equal((await a.request('/api/product/commands','POST',body,{'content-type':'text/plain'})).status,415);
  assert.equal((await a.request('/api/product/commands','POST',Buffer.from([0xc3,0x28]))).status,400);
  assert.equal((await a.request('/api/product/commands','POST',' '.repeat(8*1024*1024+1))).status,413);
  assert.equal((await a.request('/api/product/commands','POST','{"protocolVersion":1,"commandId":"x","expectedRevision":0,"operations":[{"type":"capture.draft","text":"x","__proto__":{}}]}')).status,422);
  assert.equal((await a.read()).revision,0);
});

test('existing schema v1 snapshot upgrades in place without schema migration or discarding extra fields',async t=>{
  const a=await fixture(t),legacy=await a.open(true);
  const oldHost=applyProductOperations(null,[capture(),...saveUnderstanding('既有文稿')]);
  oldHost.chain.matters[0].extraFutureField={preserved:true};
  const imported=await legacy.request('/api/web/workspace','PUT',{expectedRevision:0,commandId:'old-snapshot',host:oldHost});
  assert.equal(imported.status,200);await legacy.close();
  const state=await a.ok(chain('STOP_DRAFT',{text:'继续原来的停点'}));
  assert.equal(state.revision,2);assert.equal(state.host.chain.matters[0].understanding,'既有文稿');
  assert.deepEqual(state.host.chain.matters[0].extraFutureField,{preserved:true});
  assert.equal((await a.request('/api/product/commands/old-snapshot')).status,404);
  assert.equal((await a.request('/api/web/workspace','PUT',{expectedRevision:2,commandId:'old-overwrite',host:oldHost})).status,410);
});

test('an excluded intake affects only this work; retry snapshots use the newest saved understanding',async t=>{
  const a=await fixture(t);let state=await a.ok([capture(),...saveUnderstanding('v1'),startWork]);
  const intakeId=state.host.worksite.sessions.w.intake[0].id;
  state=await a.ok(work('SET_INTAKE_ROLE',{id:intakeId,role:'exclude'}));
  assert.equal(state.host.chain.matters[0].understanding,'v1');
  await a.ok(saveUnderstanding('v2'));
  await a.ok(work('RESULT_DRAFT',{patch:{fact:'观察到了一个差异'}}));
  state=await a.ok(work('TRY_AGAIN'));
  assert.equal(state.host.worksite.sessions.w.retry.understandingVersion,2);
  assert.equal(state.host.worksite.sessions.w.intake[0].sourceVersion,1);
  assert.equal(state.host.worksite.sessions.w.retry.sent,false);
});

test('in-memory previews never mutate their input when a later action fails',()=>{
  const host=applyProductOperations(null,[capture()]),before=structuredClone(host);
  assert.throws(()=>applyProductOperations(host,[chain('UNDERSTANDING_DRAFT',{text:'预览'}),chain('COMMIT_RESULT')]),/动作/);
  assert.deepEqual(host,before);
});

test('invalid screens/enums and saved suggestion undo are rejected instead of reporting a false commit',async t=>{
  const a=await fixture(t);await a.ok([capture(),...saveUnderstanding('原句')]);
  assert.equal((await a.execute(chain('NAVIGATE',{screen:'unknown-screen'}))).status,422);
  await a.ok([chain('SUGGEST',{start:0,end:2,replacement:'改句'}),chain('ACCEPT_SUGGESTION'),chain('SAVE_UNDERSTANDING')]);
  const revision=(await a.read()).revision;
  assert.equal((await a.execute(chain('UNDO_SUGGESTION'))).status,409);
  assert.equal((await a.execute(chain('ACCEPT_SUGGESTION'))).status,409);
  assert.equal((await a.read()).revision,revision);
  assert.equal((await a.read()).host.chain.matters[0].understanding,'改句');
});
