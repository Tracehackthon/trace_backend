import test from 'node:test';
import assert from 'node:assert/strict';
import {validateCapabilityContentContract, validateCapabilitySpec, validateSkillEntrypoint} from '../dist/packages/core/capability/src/index.js';

const ref = (record_id, kind = 'source_snapshot') => ({record_id, revision: 1, kind, schema_id: `trace.${kind}`, schema_version: '0.1.0'});
const provenance = {source_kind: 'mywiki-cognitive-source', source_refs: [ref('source-cognition-001')], change_id: 'change-capability-content-001'};
const contract = {
  protocol_id: 'trace.capability-content', protocol_version: '0.1.0',
  entrypoint: {path: 'SKILL.md', name: 'trace-example', description: '从认知源承接可验证方法。'},
  triggers: {positive: ['能力版本漂移'], negative: ['普通格式化']},
  workflow: {inputs: ['主题', 'source_refs'], steps: ['读取来源', '形成候选', '验证', '等待采用'], outputs: ['候选', '回执'], failure_modes: ['来源缺失'], stop_conditions: ['没有用户采用']},
  acceptance: {structural: ['frontmatter 可解析'], behavioral: ['第二个案例可复放'], user_visible: ['显示保存和未保存内容']},
  security: {secret_policy: 'never_include', network_policy: 'none', forbidden_scopes: ['raw-chat-transcript']},
  provenance,
};

test('capability content contract preserves cognitive-source provenance and operational boundaries', () => {
  const validated = validateCapabilityContentContract(contract);
  assert.equal(validated.provenance.source_kind, 'mywiki-cognitive-source');
  assert.equal(validated.entrypoint.path, 'SKILL.md');
  assert.deepEqual(validated.security.forbidden_scopes, ['raw-chat-transcript']);
  assert.doesNotThrow(() => validateSkillEntrypoint('---\nname: trace-example\ndescription: 从认知源承接可验证方法。\n---\n\nbody', validated));
});

test('skill capabilities require the content contract and matching entrypoint', () => {
  const base = {capability_id: 'trace-example', version: '0.1.0', display_name: 'Trace Example', description: 'Example', artifact_kind: 'skill', source_root: 'D:/source', target_root: 'D:/target', files: [{source: 'SKILL.md'}], host_compatibility: ['codex'], runtime_compatibility: {'trace-runtime': '>=0.6.0'}, provenance};
  assert.throws(() => validateCapabilitySpec(base), /content_contract/);
  assert.throws(() => validateCapabilityContentContract({...contract, entrypoint: {...contract.entrypoint, name: 'Trace_Example'}}), /lowercase/);
  assert.throws(() => validateSkillEntrypoint('---\nname: wrong\ndescription: x\n---\n\nbody', validateCapabilityContentContract(contract)), /name/);
  assert.throws(() => validateSkillEntrypoint('---\nname: trace-example\ndescription: other\n---\n\nbody', validateCapabilityContentContract(contract)), /description/);
  assert.throws(() => validateSkillEntrypoint('---\nname: trace-example\n---\n\nbody', validateCapabilityContentContract(contract)), /description/);
});
