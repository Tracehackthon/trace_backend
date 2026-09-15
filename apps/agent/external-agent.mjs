import { AgentError, demand, identity, keys, plain, text } from './protocol.mjs';
import { contextManifest, createRunToolBridge, EXECUTOR_CONTRACT_VERSION } from './runtime.mjs';
import { postRemoteJson } from './remote-http.mjs';

export const EXTERNAL_AGENT_PROTOCOL = 'trace-external-agent-v1';

export function createExternalAgentAdapter({ profile, env = process.env, fetchImpl = fetch }) {
  const send = (body, signal) => postRemoteJson({ endpoint: profile.endpoint, profile, env, body, signal, fetchImpl });
  return {
    capabilities: { tools: true, streaming: false, cancellation: true, output: 'trace-result-v1' },
    async check({ signal } = {}) {
      const response = await send({ protocolVersion: 1, operation: 'check' }, signal);
      demand(keys(response, ['protocolVersion', 'type', 'runtimeVersion', 'capabilities']) && response.protocolVersion === 1 && response.type === 'ready'
        && text(response.runtimeVersion, 200) && keys(response.capabilities, ['tools', 'streaming', 'cancellation'])
        && Object.values(response.capabilities).every(value => typeof value === 'boolean'),
      'EXTERNAL_AGENT_PROTOCOL_ERROR', '外部 Agent 未通过协议检查。', 502);
      return { runtime: EXTERNAL_AGENT_PROTOCOL, version: response.runtimeVersion, authenticated: profile.credentialEnv ? true : null,
        modelTurnTested: false, remoteCapabilities: response.capabilities, boundedPolicy: 'trace-host-tools-v1' };
    },
    async execute({ request, context, signal, onEvent, isCurrent, retrieval }) {
      const tools = createRunToolBridge({ context, retrieval, signal, isCurrent, onEvent });
      let sessionId = null, completed = false, frame;
      try {
        frame = await send({
          protocolVersion: 1,
          operation: 'start',
          executorContractVersion: EXECUTOR_CONTRACT_VERSION,
          request: { requestId: request.requestId, purpose: request.purpose, input: request.input },
          context: contextManifest(context),
          tools: tools.definitions,
        }, signal);
        for (let step = 0; step <= 12; step++) {
          demand(!signal.aborted && isCurrent(), 'STALE_CONTEXT', '目标版本、上下文或执行配置已变化。', 409);
          demand(frame.protocolVersion === 1 && identity(frame.sessionId), 'EXTERNAL_AGENT_PROTOCOL_ERROR', '外部 Agent 会话身份无效。', 502);
          if (sessionId === null) {
            sessionId = frame.sessionId;
            onEvent('runtime.connected', { sessionId, runtimeVersion: text(frame.runtimeVersion, 200) ? frame.runtimeVersion : EXTERNAL_AGENT_PROTOCOL });
          } else demand(frame.sessionId === sessionId, 'EXTERNAL_AGENT_PROTOCOL_ERROR', '外部 Agent 在运行中更换了会话身份。', 502);
          if (frame.type === 'completed') {
            demand(keys(frame, ['protocolVersion', 'type', 'sessionId', 'runtimeVersion', 'output'])
              && (plain(frame.output) || text(frame.output, 128 * 1024)), 'EXTERNAL_AGENT_PROTOCOL_ERROR', '外部 Agent 最终结果无效。', 502);
            const raw = typeof frame.output === 'string' ? frame.output : JSON.stringify(frame.output);
            demand(Buffer.byteLength(raw) <= 128 * 1024, 'OUTPUT_LIMIT', '外部 Agent 输出超过预算。', 502);
            onEvent('output.delta', { itemId: `external-${sessionId}`, delta: raw, format: 'json-fragment' });
            completed = true;
            return { raw, threadId: sessionId, turnId: `${sessionId}:${step + 1}`,
              runtimeVersion: text(frame.runtimeVersion, 200) ? frame.runtimeVersion : EXTERNAL_AGENT_PROTOCOL,
              providedFragments: tools.providedFragments };
          }
          demand(keys(frame, ['protocolVersion', 'type', 'sessionId', 'runtimeVersion', 'call']) && frame.type === 'tool_call'
            && plain(frame.call) && keys(frame.call, ['id', 'name', 'arguments']) && identity(frame.call.id)
            && identity(frame.call.name) && plain(frame.call.arguments) && tools.has(frame.call.name),
          'TOOL_NOT_ALLOWED', '外部 Agent 请求了未授权或无效工具。', 403);
          const outcome = await tools.call(frame.call.name, frame.call.arguments);
          frame = await send({ protocolVersion: 1, operation: 'tool_result', sessionId,
            call: { id: frame.call.id, success: outcome.success, result: outcome.result } }, signal);
        }
        throw new AgentError('TOOL_BUDGET', '外部 Agent 没有在工具调用预算内完成。', 502);
      } finally {
        if (sessionId && !completed) {
          const controller = new AbortController();
          const timer = setTimeout(() => controller.abort(), 2000);
          try { await send({ protocolVersion: 1, operation: 'cancel', sessionId }, controller.signal); } catch { /* best-effort remote cancellation */ }
          finally { clearTimeout(timer); }
        }
      }
    },
  };
}
