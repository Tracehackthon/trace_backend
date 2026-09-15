import path from 'node:path';
import net from 'node:net';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const help = `Trace 本机后端（源码工作区）
  npm start                 启动 Web 与产品 API
  npm start -- --agent      同时开启 Codex 生成 API（不自动发起生成）
  npm start -- --check      仅检查配置和端口，不打开数据库、不启动 Codex

Node >=22.13；Agent 需已登录且经验证的 Codex CLI。
高级配置：TRACE_WEB_STATE_FILE（绝对路径）、TRACE_DESKTOP_PORT、TRACE_AGENT_ENABLED。
沿用旧服务的数据位置；不迁移、不安装插件、不停止已有进程。
详见 docs/local-runtime.md。`;

export function configuration(args, env, nodeVersion = process.versions.node) {
  for (const arg of args) if (!['--agent', '--check', '--help'].includes(arg)) throw new Error(`未知参数 ${arg}；请用 --help。`);
  const [major, minor] = nodeVersion.split('.').map(Number);
  if (!(major > 22 || major === 22 && minor >= 13)) throw new Error('需要 Node >=22.13。');
  const value = env.TRACE_DESKTOP_PORT ?? '4173';
  if (!/^\d+$/.test(value) || Number(value) < 1 || Number(value) > 65535) throw new Error('TRACE_DESKTOP_PORT 必须是 1—65535 的整数。');
  if (env.TRACE_AGENT_ENABLED !== undefined && !['0', '1'].includes(env.TRACE_AGENT_ENABLED)) throw new Error('TRACE_AGENT_ENABLED 只能是 0 或 1。');
  const state = env.TRACE_WEB_STATE_FILE ?? path.resolve(root, '../.trace/state/web.sqlite');
  if (!path.isAbsolute(state)) throw new Error('TRACE_WEB_STATE_FILE 必须是绝对路径；不会猜测或迁移旧库。');
  return { port: Number(value), state: path.resolve(state), agent: args.includes('--agent') || env.TRACE_AGENT_ENABLED === '1', check: args.includes('--check') };
}

export async function checkPort(port) {
  const probe = net.createServer();
  await new Promise((resolve, reject) => {
    probe.once('error', error => reject(new Error(error.code === 'EADDRINUSE'
      ? `端口 ${port} 已占用。请核对原服务归属；不会停止进程或自动换端口。`
      : `无法监听本机端口 ${port}：${error.code}`)));
    probe.listen(port, '127.0.0.1', () => probe.close(resolve));
  });
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes('--help')) { console.log(help); return; }
  const config = configuration(args, process.env);
  await checkPort(config.port);
  console.log(`本机地址：http://127.0.0.1:${config.port}`);
  console.log(`产品数据：${config.state}`);
  console.log(`Codex 生成 API：${config.agent ? '开启；页面尚未接入，不会自动生成' : '关闭'}`);
  if (config.check) {
    console.log('配置与端口检查通过；未检查数据库、Codex 登录、模型额度或运行中服务。');
    return;
  }
  process.env.TRACE_WEB_STATE_FILE = config.state;
  process.env.TRACE_DESKTOP_PORT = String(config.port);
  process.env.TRACE_AGENT_ENABLED = config.agent ? '1' : '0';
  // Keep the existing host and its shutdown handlers in this process. No shell,
  // second service, port fallback, database migration or global configuration.
  await import('../apps/desktop/server.mjs');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(`Trace 启动失败：${error.message}`); process.exitCode = 1; });
}
