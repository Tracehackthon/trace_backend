import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {ZhihuHttpTransport, ZhihuTransportError} from '../dist/packages/integration/zhihu-transport/src/index.js';
import {MyWikiSourceProvider} from '../dist/packages/integration/mywiki-source/src/index.js';
import {CodexSkillInstaller} from '../dist/packages/host/codex-skill/src/index.js';
import {CodexHookInstaller} from '../dist/packages/host/codex-hooks/src/index.js';

const zhihuProfile = {platform_base_url: 'https://developer.zhihu.com', hackathon_base_url: 'https://api.zhihu.com', access_secret_env: 'TRACE_TEST_ZHIHU_SECRET', timeout_ms: 5000};

test('Zhihu transport sends the documented auth headers and keeps the response envelope', async () => {
  let seen;
  const transport = new ZhihuHttpTransport({...zhihuProfile, access_secret: 'test-secret', fetch_impl: async (input, init) => {
    seen = {url: String(input), headers: Object.fromEntries((init?.headers instanceof Headers ? init.headers : new Headers(init?.headers)).entries())};
    return new Response(JSON.stringify({Code: 0, Message: 'ok', Data: {Items: [{Title: 'agent collaboration', ContentID: '42', ContentText: 'bounded summary', Url: 'https://www.zhihu.com/question/42'}]}}), {status: 200, headers: {'content-type': 'application/json'}});
  }});
  const result = await transport.search('agent collaboration', 1);
  assert.equal(result.Code, 0);
  assert.match(seen.url, /Query=agent\+collaboration/);
  assert.equal(seen.headers.authorization, 'Bearer test-secret');
  assert.match(seen.headers['x-request-timestamp'], /^\d+$/);
});

test('Zhihu transport fails closed without a secret and never puts it in errors', async () => {
  const transport = new ZhihuHttpTransport({...zhihuProfile, fetch_impl: async () => { throw new Error('must not fetch'); }});
  await assert.rejects(() => transport.search('x'), error => error instanceof ZhihuTransportError && error.code === 'AUTH_REQUIRED' && !error.message.includes('secret'));
});

test('Zhihu hackathon detail only accepts a list-derived single path segment', async () => {
  const transport = new ZhihuHttpTransport({...zhihuProfile, fetch_impl: async () => new Response('{}', {status: 200})});
  await assert.rejects(() => transport.hackathonStoryDetail('id/with/slash'), /single list-derived path segment/);
});

test('MyWiKi formal source reads, snapshots, proposes and CAS-applies a page with a backup', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'trace-mywiki-')); const pageFile = path.join(dir, 'wiki', 'knowledge', '协作.md'); fs.mkdirSync(path.dirname(pageFile), {recursive: true});
  fs.writeFileSync(pageFile, '---\ntitle: 协作\nstatus: evergreen\n---\n\n首版判断\n', 'utf8');
  const provider = new MyWikiSourceProvider({source_id: 'user-wiki', root: dir, user_id: 'u1', write_enabled: true});
  let page = provider.readPage('wiki/knowledge/协作.md'); assert.equal(page.title, '协作'); assert.equal(page.frontmatter.status, 'evergreen');
  // Revision is content-derived rather than timestamp-derived: coarse mtime filesystems
  // cannot make a changed page look unchanged to a pointer/CAS consumer.
  const fixedTime = new Date('2026-09-10T00:00:00.000Z');
  fs.utimesSync(pageFile, fixedTime, fixedTime);
  const firstRevision = provider.readPage('wiki/knowledge/协作.md').revision;
  fs.writeFileSync(pageFile, '---\ntitle: 协作\nstatus: evergreen\n---\n\n同一时间粒度内的更新\n', 'utf8');
  fs.utimesSync(pageFile, fixedTime, fixedTime);
  const sameMtimeChanged = provider.readPage('wiki/knowledge/协作.md');
  assert.notEqual(sameMtimeChanged.revision, firstRevision);
  fs.writeFileSync(pageFile, page.markdown, 'utf8');
  fs.utimesSync(pageFile, fixedTime, fixedTime);
  page = provider.readPage('wiki/knowledge/协作.md');
  const snapshot = provider.buildSourceSnapshot(page, {run_id: 'read-1'}); assert.equal(snapshot.payload.content_hash, page.content_hash); assert.equal(snapshot.origin.locator, 'wiki/knowledge/协作.md');
  const proposal = provider.proposeWrite({relative_path: page.relative_path, expected_revision: page.revision, expected_hash: page.content_hash, next_markdown: page.markdown.replace('首版判断', '第二版判断'), reason: '用户确认后的正式页修订', requested_by: 'u1'});
  const backupRoot = path.join(dir, '.trace-backups'); const receipt = provider.applyWrite(proposal, `approve:${proposal.proposal_id}`, backupRoot); assert.equal(receipt.status, 'applied'); assert.equal(fs.readFileSync(pageFile, 'utf8').includes('第二版判断'), true); assert.equal(fs.existsSync(receipt.backup_path), true);
  assert.throws(() => provider.proposeWrite({relative_path: page.relative_path, expected_revision: page.revision, expected_hash: page.content_hash, next_markdown: 'stale', reason: 'stale', requested_by: 'u1'}), /STALE_SOURCE/);
  assert.throws(() => provider.proposeWrite({relative_path: 'raw/inbox/不应改.md', expected_revision: 1, expected_hash: page.content_hash, next_markdown: 'x', reason: 'raw', requested_by: 'u1'}), /Only formal pages/);
});

test('Skill replacement and Codex hooks switch are atomic, explicit and reversible', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'trace-host-')); const source = path.join(dir, 'skill'); fs.mkdirSync(source); fs.writeFileSync(path.join(source, 'SKILL.md'), '---\nname: trace-agent-collaboration\n---\n', 'utf8'); fs.writeFileSync(path.join(source, 'README.md'), 'new\n', 'utf8');
  const skillRoot = path.join(dir, 'codex', 'skills'); fs.mkdirSync(path.join(skillRoot, 'trace-agent-collaboration'), {recursive: true}); fs.writeFileSync(path.join(skillRoot, 'trace-agent-collaboration', 'SKILL.md'), 'old\n', 'utf8'); const installer = new CodexSkillInstaller(skillRoot); const preview = installer.preview(source); assert.equal(preview.changed, true); const skillReceipt = installer.install(source, {backup_root: path.join(dir, 'backups'), approval: 'approve:trace-agent-collaboration'}); assert.equal(fs.readFileSync(path.join(skillRoot, 'trace-agent-collaboration', 'README.md'), 'utf8'), 'new\n'); assert.ok(skillReceipt.backup_dir); installer.rollback(skillReceipt); assert.equal(fs.readFileSync(path.join(skillRoot, 'trace-agent-collaboration', 'SKILL.md'), 'utf8'), 'old\n');
  const hooksFile = path.join(dir, 'hooks.json'); fs.writeFileSync(hooksFile, JSON.stringify({hooks: {UserPromptSubmit: [{hooks: [{type: 'command', command: 'python trace_hook.py'}]}], SessionStart: [], Stop: [{hooks: [{type: 'command', command: 'keep-me'}]}]}})); const hooks = new CodexHookInstaller(hooksFile); const hookReceipt = hooks.install({command: 'node trace-runtime codex hook-stdio --sqlite-state-file C:/state.sqlite', backup_root: path.join(dir, 'hook-backups'), approval: 'approve:codex-hooks'}); const installed = JSON.parse(fs.readFileSync(hooksFile, 'utf8')); assert.equal(installed.hooks.UserPromptSubmit[0].hooks[0].command.startsWith('node trace-runtime'), true); assert.equal(installed.hooks.Stop[0].hooks[0].command, 'keep-me'); hooks.rollback(hookReceipt); assert.equal(JSON.parse(fs.readFileSync(hooksFile, 'utf8')).hooks.UserPromptSubmit[0].hooks[0].command, 'python trace_hook.py');
});
