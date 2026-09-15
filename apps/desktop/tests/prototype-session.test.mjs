import test from 'node:test'
import assert from 'node:assert/strict'
import { createPrototypeSession } from '../src/prototype-session.js'

test('one updated stop is projected to home, search and reentry', () => {
  const s = createPrototypeSession()
  s.dispatch({type:'OPEN',id:'collection'})
  s.dispatch({type:'SAVE_JUDGMENT',text:'同一个最新停点'})
  assert.match(s.homeEntries().thought.subtitle,/同一个最新停点/)
  s.dispatch({type:'SEARCH',query:'同一个最新停点'})
  assert.equal(s.view().search.matters[0].id,'collection')
  s.dispatch({type:'OPEN',id:s.homeMatterId('thought')})
  assert.equal(s.view().selected.currentJudgment,'同一个最新停点')
})
test('capture is new, literal, isolated, searchable and does not overwrite examples', () => {
  const s = createPrototypeSession(), baseline = structuredClone(s.getState().matters[0])
  assert.equal(s.capture('   '),null)
  const first=s.capture('<b>自己的原文</b>'), second=s.capture('另一个新问题')
  assert.notEqual(first,second)
  assert.deepEqual(s.getState().matters[0],baseline)
  assert.equal(s.homeMatterId('thought'),second)
  s.dispatch({type:'SEARCH',query:'自己的原文'})
  assert.equal(s.view().search.matters[0].id,first)
  s.dispatch({type:'OPEN',id:first})
  assert.equal(s.view().selected.whyCare,'<b>自己的原文</b>')
  assert.equal(s.view().selected.sources[0].example,false)
})
test('new page session resets without mutating the previous session', () => {
  const first=createPrototypeSession();first.capture('本次内容')
  const fresh=createPrototypeSession()
  assert.equal(fresh.getState().matters.length,6)
  assert.equal(first.getState().matters.length,7)
})
test('new capture without a material cannot manufacture a challenge relation', () => {
  const s=createPrototypeSession(),id=s.capture('还没有来源')
  s.dispatch({type:'OPEN',id})
  s.dispatch({type:'RELATE',relation:'challenge'})
  assert.equal(s.view().selected.relation,'unreviewed')
  assert.equal(s.view().selected.changed,false)
})
