import { randomUUID } from 'node:crypto';
import { AgentError, demand, identity, keys, plain, text } from './protocol.mjs';
import { contextManifest, createRunToolBridge, TRACE_AGENT_INSTRUCTIONS, TRACE_AGENT_RETRIEVAL_INSTRUCTIONS } from './runtime.mjs';
import { postRemoteJson } from './remote-http.mjs';

const MODEL_PROTOCOL = 'openai-chat-completions-v1';
const providerTools = definitions => definitions.map(tool => ({
  type: 'function',
  function: { name: tool.name, description: tool.description, parameters: tool.inputSchema },
}));

export function createModelAdapter({ profile, env = process.env, fetchImpl = fetch }) {
  const send = (body, signal) => postRemoteJson({ endpoint: profile.endpoint, profile, env, body, signal, fetchImpl });
  return {
    capabilities: { tools: true, streaming: false, cancellation: true, output: 'trace-result-v1' },
    async check() {
      // OpenAI-compatible chat endpoints have no non-generating health method.
      // Config and credential presence are checked without spending model quota.
      if (profile.credentialEnv) demand(typeof env[profile.credentialEnv] === 'string' && env[profile.credentialEnv].length > 0,
        'PROFILE_CREDENTIAL_UNAVAILABLE', '所选 Agent profile 的服务端凭据不可用。', 503);
      return { runtime: MODEL_PROTOCOL, configured: true, authenticated: profile.credentialEnv ? true : null,
        model: profile.model, modelTurnTested: false, boundedPolicy: 'trace-bounded-v1' };
    },
    async execute({ request, context, signal, onEvent, isCurrent, retrieval }) {
      const sessionId = randomUUID();
      const tools = createRunToolBridge({ context, retrieval, signal, isCurrent, onEvent });
      const instructions = retrieval?.tools.length ? TRACE_AGENT_RETRIEVAL_INSTRUCTIONS : TRACE_AGENT_INSTRUCTIONS;
      const messages = [
        { role: 'system', content: instructions },
        { role: 'user', content: JSON.stringify({ purpose: request.purpose, input: request.input, context: contextManifest(context) }) },
      ];
      onEvent('runtime.connected', { sessionId, runtimeVersion: MODEL_PROTOCOL, model: profile.model });
      for (let step = 0; step <= 12; step++) {
        demand(!signal.aborted && isCurrent(), 'STALE_CONTEXT', '目标版本、上下文或执行配置已变化。', 409);
        const response = await send({ model: profile.model, stream: false, messages, tools: providerTools(tools.definitions), tool_choice: 'auto' }, signal);
        const message = response.choices?.[0]?.message;
        demand(plain(message), 'MODEL_PROTOCOL_ERROR', '模型服务没有返回有效消息。', 502);
        const calls = message.tool_calls;
        if (Array.isArray(calls) && calls.length) {
          demand(calls.length <= 12 && calls.every(call => plain(call)), 'MODEL_PROTOCOL_ERROR', '模型工具调用结构无效。', 502);
          const safeCalls = [];
          for (const call of calls) {
            demand(identity(call.id) && call.type === 'function' && plain(call.function) && identity(call.function.name)
              && text(call.function.arguments, 64 * 1024) && tools.has(call.function.name),
            'TOOL_NOT_ALLOWED', '模型请求了未授权或无效工具。', 403);
            let args;
            try { args = JSON.parse(call.function.arguments); } catch { throw new AgentError('INVALID_TOOL_INPUT', '模型工具参数不是有效 JSON。', 502); }
            demand(plain(args), 'INVALID_TOOL_INPUT', '模型工具参数必须是对象。', 502);
            safeCalls.push({ id: call.id, type: 'function', function: { name: call.function.name, arguments: call.function.arguments } });
          }
          messages.push({ role: 'assistant', content: typeof message.content === 'string' ? message.content : null, tool_calls: safeCalls });
          for (const call of safeCalls) {
            const outcome = await tools.call(call.function.name, JSON.parse(call.function.arguments));
            messages.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify(outcome.result), name: call.function.name });
          }
          continue;
        }
        demand(keys(message, ['role', 'content', 'refusal', 'annotations', 'audio']) || typeof message.content === 'string',
          'MODEL_PROTOCOL_ERROR', '模型最终消息结构无效。', 502);
        demand(text(message.content, 128 * 1024) && message.content.trim(), 'MODEL_PROTOCOL_ERROR', '模型没有返回最终结构化结果。', 502);
        onEvent('output.delta', { itemId: `model-${sessionId}`, delta: message.content, format: 'json-fragment' });
        return { raw: message.content, threadId: sessionId, turnId: `${sessionId}:${step + 1}`, runtimeVersion: MODEL_PROTOCOL,
          providedFragments: tools.providedFragments };
      }
      throw new AgentError('TOOL_BUDGET', '模型没有在工具调用预算内完成。', 502);
    },
  };
}
