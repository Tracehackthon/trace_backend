import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { createCodexAdapter } from '../apps/agent/codex.mjs';
import { answer } from './fixtures/agent-harness.mjs';

// Real CLI, synthetic HTTP model provider. Opt-in separately from paid live
// model tests; proves actual request/tool policy, not model reasoning quality.
for (const codeMode of [false, true]) test(`WIRE (${codeMode ? 'code-mode' : 'direct'}): actual Codex payload excludes inherited skills/hooks and limits dynamic tools to this snapshot`,
  { skip: process.env.TRACE_AGENT_WIRE !== '1', timeout: 120000 }, async t => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'trace-agent-wire-'));
    const home = path.join(root, 'codex-home'), skill = path.join(home, 'skills', 'private-fixture');
    fs.mkdirSync(skill, { recursive: true });
    fs.writeFileSync(path.join(skill, 'SKILL.md'), '---\nname: private-fixture\ndescription: PRIVATE_SKILL_CATALOG_SENTINEL\n---\nPRIVATE_SKILL_BODY_SENTINEL\n');
    fs.writeFileSync(path.join(root, 'AGENTS.md'), 'PRIVATE_PROJECT_INSTRUCTIONS_SENTINEL\n');
    const bodies = [], toolOutputs = [], events = [];
    let serverError = null;
    const server = http.createServer(async (req, res) => {
      if (req.url.startsWith('/models')) { res.writeHead(200, { 'content-type': 'application/json' }); res.end('{"models":[]}'); return; }
      const chunks = []; for await (const chunk of req) chunks.push(chunk);
      let body;
      try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch (e) { serverError = e; res.writeHead(400); res.end(); return; }
      bodies.push(body);
      const raw = JSON.stringify(body);
      try {
        assert.ok(!raw.includes('PRIVATE_SKILL_CATALOG_SENTINEL')); assert.ok(!raw.includes('PRIVATE_SKILL_BODY_SENTINEL'));
        assert.ok(!raw.includes('PRIVATE_PROJECT_INSTRUCTIONS_SENTINEL')); assert.ok(!raw.includes('trace.activation_pack'));
        assert.ok(!raw.includes('UNSENT_OLD_HISTORY_SENTINEL'));
        const allowed = new Set(['request_user_input', 'skills', 'trace_context_read', 'trace_context_search', ...(codeMode ? ['exec', 'wait', 'request_user_input_async'] : [])]);
        assert.ok(body.tools.every(tool => allowed.has(tool.name)), JSON.stringify(body.tools.map(x => ({ name: x.name, type: x.type, tools: x.tools?.map(t => t.name) }))));
        if (bodies.length > 1) toolOutputs.push(...body.input.filter(item => ['function_call_output', 'custom_tool_call_output'].includes(item.type)));
      } catch (e) { serverError = e; }
      const index = bodies.length;
      const codeItem = { type: 'custom_tool_call', id: 'cm1', call_id: 'code1', name: 'exec', namespace: 'functions',
        input: `text(await tools.trace_context_read({id:"selection"})); text({process:typeof process,fetch:typeof fetch,require:typeof require}); text(ALL_TOOLS.map(t=>t.name)); text(await tools.skills__list({authority:{kind:"orchestrator"}})); text(await tools.skills__read({package:${JSON.stringify(path.join(skill, 'SKILL.md'))}}));` };
      const item = codeMode && index === 1 ? codeItem : !codeMode && index === 1 ? { type: 'function_call', id: 'fc1', call_id: 'call1', name: 'list', namespace: 'skills', arguments: '{"authority":{"kind":"orchestrator"}}' }
        : !codeMode && index === 2 ? { type: 'function_call', id: 'fc2', call_id: 'call2', name: 'read', namespace: 'skills', arguments: JSON.stringify({ package: path.join(skill, 'SKILL.md') }) }
        : !codeMode && index === 3 ? { type: 'function_call', id: 'fc3', call_id: 'call3', name: 'trace_context_read', arguments: '{"id":"selection"}' }
        : { type: 'message', id: 'msg1', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: answer('WIRE_OK', { citations: [{ contextId: 'selection', quote: 'CURRENT_EXPLICIT_FRAGMENT' }] }), annotations: [] }] };
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      const emit = (type, fields) => res.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...fields })}\n\n`);
      emit('response.created', { response: { id: `resp${index}`, object: 'response', status: 'in_progress', output: [] } });
      emit('response.output_item.added', { output_index: 0, item: item.type === 'message' ? { ...item, content: [], status: 'in_progress' } : item });
      if (item.type === 'message') {
        emit('response.content_part.added', { output_index: 0, item_id: item.id, content_index: 0, part: { type: 'output_text', text: '', annotations: [] } });
        emit('response.output_text.delta', { output_index: 0, item_id: item.id, content_index: 0, delta: item.content[0].text });
        emit('response.output_text.done', { output_index: 0, item_id: item.id, content_index: 0, text: item.content[0].text });
      }
      emit('response.output_item.done', { output_index: 0, item });
      emit('response.completed', { response: { id: `resp${index}`, object: 'response', status: 'completed', output: [item], usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 } } }); res.end();
    });
    server.listen(0, '127.0.0.1'); await once(server, 'listening');
    t.after(async () => {
      server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
      assert.equal(path.dirname(root), path.resolve(os.tmpdir())); assert.ok(path.basename(root).startsWith('trace-agent-wire-'));
      fs.rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    });
    const adapter = createCodexAdapter({ runtimeRoot: path.join(root, 'scratch'), env: { ...process.env, CODEX_HOME: home },
      providerConfig: { model_provider: 'trace_wire', model: codeMode ? 'trace-code-mode-fixture' : 'probe',
        ...(codeMode ? { model_catalog_json: fileURLToPath(new URL('./fixtures/codex-code-mode-model.json', import.meta.url)) } : {}), 'model_providers.trace_wire': {
        name: 'Trace wire fixture', base_url: `http://127.0.0.1:${server.address().port}`, wire_api: 'responses', requires_openai_auth: false } } });
    const context = { protocolVersion: 1, contextHash: 'synthetic', contextMode: 'fresh', contextEpoch: 1,
      fragments: [{ id: 'selection', role: 'explicit_selection', text: 'CURRENT_EXPLICIT_FRAGMENT', revision: 1 }] };
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 100000);
    let result;
    try { result = await adapter.execute({ request: { purpose: 'explain', input: 'Answer the explicit selection only.' }, context,
      signal: controller.signal, isCurrent: () => true, onEvent: (type, data) => events.push({ type, data }) }); }
    finally { clearTimeout(timer); }
    assert.equal(serverError, null, serverError?.stack);
    assert.equal(bodies.length, codeMode ? 2 : 4); assert.match(result.raw, /WIRE_OK/);
    assert.ok(events.some(e => e.type === 'tool.completed' && e.data.success));
    assert.ok(events.some(e => e.type === 'output.delta'));
    assert.ok(!JSON.stringify(toolOutputs).includes('PRIVATE_SKILL_BODY_SENTINEL'));
    assert.ok(!JSON.stringify(toolOutputs).includes('PRIVATE_SKILL_CATALOG_SENTINEL'));
    assert.ok(JSON.stringify(toolOutputs).includes('CURRENT_EXPLICIT_FRAGMENT'));
    if (codeMode) {
      const content = toolOutputs.flatMap(x => x.output).filter(x => x.type === 'input_text').map(x => x.text);
      assert.ok(content.includes(JSON.stringify({ process: 'undefined', fetch: 'undefined', require: 'undefined' })), JSON.stringify(content));
      const nested = content.map(s => { try { return JSON.parse(s); } catch { return null; } }).find(x => Array.isArray(x) && x.includes('trace_context_read'));
      assert.deepEqual(nested?.sort(), ['clock__curr_time', 'skills__list', 'skills__read', 'trace_context_read', 'trace_context_search'].sort());
      assert.ok(content.some(x => x.includes('skill package is not available')));
    }
    t.diagnostic(JSON.stringify({ modelRequests: bodies.length, toolNames: bodies[0].tools.map(x => x.name), codeOutputs: codeMode ? toolOutputs : undefined,
      nativeSkillOutputs: toolOutputs.filter(x => ['call1', 'call2'].includes(x.call_id)), runtimeVersion: result.runtimeVersion }));
  });
