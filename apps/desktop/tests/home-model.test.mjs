import test from 'node:test'
import assert from 'node:assert/strict'
import {routeFor,createState,transition,LAYOUTS,PATHS,NODE_POSITIONS,MODES} from '../src/home-model.js'

test('default and explicit home routes isolate legacy styles',()=>{
  assert.equal(routeFor(''),'home'); assert.equal(routeFor('?state=work'),'home')
  assert.equal(routeFor('?from=trace-native&view=home'),'home')
})
test('legacy query presence and native bridge entry remain discussions',()=>{
  for(const query of ['?from=trace-native','?from=deepseek-harness','?observationId=','?text=','?source=example','?status=待确认','?view=discussion'])assert.equal(routeFor(query),'discussion',query)
})
test('unknown preview state resets cleanly',()=>assert.equal(createState('invalid').mode,'overview'))
test('empty capture never mutates state',()=>{const s=createState();assert.equal(transition(s,{type:'CAPTURE',text:'  '}),s)})
test('capture and understanding preserve literal user text',()=>{
  let s=transition(createState(),{type:'CAPTURE',text:'  <svg onload=alert(1)>一段想法  '})
  assert.equal(s.mode,'thinking');assert.equal(s.captured,'<svg onload=alert(1)>一段想法')
  s=transition(s,{type:'GROW',text:'另一种情形'});assert.equal(s.mode,'growth');assert.equal(s.insight,'另一种情形')
})
test('work return does not automatically claim verification',()=>{
  let s=transition(createState(),{type:'WORK'});assert.equal(s.mode,'work')
  assert.equal(transition(s,{type:'RETURN',text:' '}),s)
  s=transition(s,{type:'RETURN',text:'没有通过验证'});assert.equal(s.mode,'return');assert.equal(s.result,'没有通过验证');assert.equal(s.sampleResult,false)
})
test('close returns to scene without erasing current-session content',()=>{
  const s=transition({...createState('return'),result:'保留这次发现'},{type:'CLOSE'});assert.equal(s.mode,'overview');assert.equal(s.result,'保留这次发现')
})
test('every approved mode has complete graph coordinates',()=>{
  for(const mode of MODES){assert.equal(PATHS[mode].length,5);assert.equal(NODE_POSITIONS[mode].length,6);for(const box of Object.values(LAYOUTS[mode]))assert.ok(box.every(Number.isFinite))}
})
