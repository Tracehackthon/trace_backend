// Seeds demo data into the running Trace web workspace.
// Usage: node scripts/seed-demo.mjs
//   or:  node scripts/seed-demo.mjs --port 4173 --reset
//
// Default behaviour: load demo data only if the workspace is empty (no matters).
// With --reset: always replace existing contents.
import http from 'node:http';

const PORT = Number(process.env.TRACE_DESKTOP_PORT || (process.argv.find(a => a.startsWith('--port='))?.split('=')[1]) || 4173);
const HOST = process.env.TRACE_DESKTOP_HOST || '127.0.0.1';
const FORCE_RESET = process.argv.includes('--reset') || process.env.TRACE_DEMO_FORCE === '1';

function request(method, path, body) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const req = http.request({
      host: HOST, port: PORT, method, path,
      headers: {
        'Accept': 'application/json',
        'Origin': `http://${HOST}:${PORT}`,
        ...(data ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } : {}),
      },
    }, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        try { resolve({ status: res.statusCode, body: text ? JSON.parse(text) : null }); }
        catch { resolve({ status: res.statusCode, body: text }); }
      });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

function blankMatter(id) {
  return {
    id, title: '', whyCare: '', stop: '', stopDraft: '', stopVersion: 0,
    originalText: '', understanding: '', understandingDraft: '',
    understandingVersion: 0, understandingDraftVersion: 0,
    sourceIds: [], captureSourceIds: [], branches: [], observations: [],
    revisions: [], results: [], links: [], comparisonRequests: [],
    originalExpressionId: `${id}:original`, originalTextVersion: 1,
  };
}

function blankHandoff() {
  return {
    destination: { agent: '', project: '', task: '' },
    selectedText: '', selectionEdited: false,
    role: 'trial', note: '', scope: 'current-task',
    confirmed: false, understandingVersion: 0, evidenceLevel: 'none',
  };
}

function blankDiscussion() {
  return { cases: [], messages: [], possibility: '' };
}

function blankIncoming() {
  return { sourceId: null, text: '', decision: 'saved' };
}

function blankSession(matterId) {
  return {
    backStack: ['reading'], comparison: null,
    composer: { text: '' }, contextEpoch: 0, contextMode: 'resume',
    discussion: blankDiscussion(), discussionVersion: 1,
    focus: null, handoff: blankHandoff(), handoffHistory: [], handoffSnapshot: null,
    incoming: blankIncoming(),
    result: { baseDraftVersion: null, baseStopVersion: null, baseVersion: null, decision: 'pending', fact: '', interpretation: '', proposedUnderstanding: '', savedId: null, unconfirmed: '' },
    results: [], findings: [], screen: 'resume',
  };
}

const DEMO_MATTERS = [
  {
    id: 'matter-demo-writing',
    originalText: '这一周观察自己：每次想写点东西都先怀疑写得不够好，结果一直没动笔。',
    title: '写得不够好就不要动笔',
    whyCare: '不是没东西写，是被「够好」这个标准先按住了。',
    understanding: '把「写得好」放在「写下来」前面，等于让标准替我按下暂停键。\n\n先写下来，再判断好不好——顺序变了，结果也会变。',
    stop: '下次想动笔又犹豫时，先问：我是在判断质量，还是在回避开始。',
  },
  {
    id: 'matter-demo-review',
    originalText: 'review 时看到同事在 if-else 里嵌套三层，早就想说但忍住没讲。',
    title: '忍住没讲的 review',
    whyCare: '沉默不等于不得罪人；该说的判断不说出口，团队会一起摸不清标准。',
    understanding: '以后在 review 看到嵌套，先问一句：这层 if 是判断输入，还是在补漏。\n\n把判断说出口，本身就是建立共同标准的一部分。',
    stop: '下次 review 第一句话留给自己：我想忍的，是判断还是冲突。',
  },
  {
    id: 'matter-demo-handoff',
    originalText: '把 handoff 里项目文档那一份带过去，结果发现对方的实际项目和文档里写的不是一回事。',
    title: '带入的不仅是内容，还有假设',
    whyCare: '内容是显性的，假设是隐性的；不核假设，等于把对方的判断也替了。',
    understanding: '以后带东西给 Agent 或同事之前，先列 3 行这个内容背后我以为成立、但其实没核过的事。\n\n这 3 行不必给对方看，是提醒自己哪些地方可能踩空。',
    stop: '这次还欠一次复盘：当时的 3 行假设，哪些是真的，哪些是猜的。',
  },
];

const DEMO_SOURCES = [
  {
    id: 'source-demo-1', kind: 'user-observation', ownerMatterId: 'matter-demo-handoff',
    title: '把项目文档带过去的那次', excerpt: '文档里写的是 3 个里程碑，对方的实际项目已经走到了第 5 个。', url: null,
  },
];

function buildDemoHost(currentRevision) {
  const chainMeta = {
    capture: { excerpt: '', excerptSourceId: null, sourceIds: [], text: '' },
    collapseUndo: null, isDemo: false, nextId: 4, notice: '', schemaVersion: 1,
    screen: 'resume', selectedId: 'matter-demo-writing',
    unassignedMaterials: [],
  };
  const matters = DEMO_MATTERS.map((m, i) => ({
    ...blankMatter(m.id),
    title: m.title,
    originalText: m.originalText,
    whyCare: m.whyCare,
    stop: m.stop,
    stopDraft: m.stop,
    stopVersion: 1,
    understanding: m.understanding,
    understandingDraft: m.understanding,
    understandingVersion: 1,
    understandingDraftVersion: 1,
    captureSourceIds: [],
    sourceIds: i === 2 ? ['source-demo-1'] : [],
    origin: 'user',
  }));
  const sessions = Object.fromEntries(matters.map(m => [m.id, blankSession(m.id)]));
  // Wire the demo source into its matter's session as an observation.
  sessions['matter-demo-handoff'].incoming = { sourceId: 'source-demo-1', text: DEMO_SOURCES[0].excerpt, decision: 'linked' };
  return {
    schemaVersion: 1,
    preferences: { displayName: '', reduceMotion: false },
    chain: { ...chainMeta, matters, sources: DEMO_SOURCES, sessions },
    comparisons: {},
    worksite: { schemaVersion: 1, isDemo: false, nextId: 1, notice: '', selectedWorkId: null, works: {}, sessions: {} },
    workGuards: {},
    route: { view: 'home' },
    error: null,
  };
}

async function main() {
  console.log(`→ Reading current workspace at http://${HOST}:${PORT}/api/web/workspace`);
  const get = await request('GET', '/api/web/workspace');
  if (get.status !== 200) {
    console.error('GET workspace failed:', get.status, get.body);
    process.exit(1);
  }
  const current = get.body;
  const host = current.host;
  if (!FORCE_RESET && host && host.chain && host.chain.matters && host.chain.matters.length > 0) {
    console.log(`· Workspace already has ${host.chain.matters.length} matter(s); use --reset to overwrite. Exiting.`);
    process.exit(0);
  }
  const demoHost = buildDemoHost(current.revision);
  const commandId = `cmd-seed-demo-${Date.now().toString(36)}`;
  console.log(`→ Resetting workspace and loading ${demoHost.chain.matters.length} demo matters...`);
  const reset = await request('POST', '/api/web/reset', { commandId, host: demoHost });
  if (reset.status !== 200) {
    console.error('POST reset failed:', reset.status, reset.body);
    process.exit(2);
  }
  console.log(`✓ Loaded demo data. New revision: ${reset.body.revision}`);
  for (const m of demoHost.chain.matters) {
    console.log(`   · ${m.id}  「${m.title}」`);
  }
}

main().catch(err => { console.error(err); process.exit(99); });