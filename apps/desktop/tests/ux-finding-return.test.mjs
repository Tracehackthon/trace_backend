import test from 'node:test';
import assert from 'node:assert/strict';
import {createWorksiteState, reduceWorksite} from '../../../packages/product/workspace/src/worksite-model.mjs';
import {recordsOf,queryRecords} from '../src/product/library.mjs';

test('reopening an earlier saved finding links that finding, not the most recent one', () => {
  let state=createWorksiteState({
    matters:[{id:'matter',title:'一件事',understanding:'',stop:''}],
    works:[{id:'work',title:'一次工作',agent:'Codex',project:'test',intake:[{id:'intake',matterId:'matter',title:'一件事'}]}],
  });
  const act=action=>{state=reduceWorksite(state,action);};
  for(const value of ['第一条发现','第二条发现']){
    act({type:'COMPOSER_DRAFT',text:value});
    act({type:'OPEN_FINDING'});
    act({type:'KEEP_FINDING'});
  }
  const session=state.sessions.work;
  assert.equal(session.finding.text,'第二条发现');
  const [first,second]=session.findings;
  const host={chain:{matters:[],sources:[]},worksite:{works:{work:state.works.work},sessions:{work:session}}};
  assert.equal(recordsOf(host).find(row=>row.id===`work:${first.id}`).route.findingId,first.id);
  act({type:'OPEN_SAVED_FINDING',id:first.id});
  assert.equal(state.sessions.work.finding.text,'第一条发现');
  act({type:'SET_FINDING_RELATION',decision:'linked',matterId:'matter'});
  assert.equal(state.sessions.work.findings[0].relation,'linked');
  assert.equal(state.sessions.work.findings[1].relation,'pending');
  assert.equal(state.sessions.work.findings[1].text,second.text);
  const updated={chain:{matters:[],sources:[]},worksite:{works:{work:state.works.work},sessions:{work:state.sessions.work}}};
  assert.deepEqual(queryRecords(updated,{matterId:'matter'}).filter(row=>row.id.includes(':finding:')).map(row=>row.text),['第一条发现']);
  assert.equal(queryRecords(updated,{}).filter(row=>row.id.includes(':finding:')).length,2);
  act({type:'OPEN_SAVED_FINDING',id:second.id});
  act({type:'SET_FINDING_RELATION',decision:'unrelated'});
  const unrelated={chain:{matters:[],sources:[]},worksite:{works:{work:state.works.work},sessions:{work:state.sessions.work}}};
  assert.deepEqual(queryRecords(unrelated,{matterId:'matter'}).filter(row=>row.id.includes(':finding:')).map(row=>row.text),['第一条发现']);
});

test('unknown saved finding never falls through to the currently selected finding', () => {
  const state=createWorksiteState({matters:[{id:'matter'}],works:[{id:'work',title:'一次工作',agent:'Codex',project:'test'}]});
  const next=reduceWorksite(state,{type:'OPEN_SAVED_FINDING',id:'not-found'});
  assert.equal(next.sessions.work.finding.id,null);
  assert.match(next.notice,/没有找到这条现场发现/);
});
