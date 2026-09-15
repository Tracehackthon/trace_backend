import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import net from 'node:net';
import {once} from 'node:events';
import {spawn} from 'node:child_process';
import {createRequire} from 'node:module';

test('browser: actual desktop server, search and OAuth UI consume backend results without demo fallback or state writes',
  {skip: process.env.TRACE_BROWSER_TESTS !== '1', timeout: 90000}, async t => {
    const {chromium} = createRequire(import.meta.url)(process.env.TRACE_PLAYWRIGHT_MODULE || 'playwright');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'trace-zhihu-web-'));
    const reservation = net.createServer(); reservation.listen(0, '127.0.0.1'); await once(reservation, 'listening');
    const port = reservation.address().port; await new Promise(resolve => reservation.close(resolve));
    const origin = `http://127.0.0.1:${port}`;
    const child = spawn(process.execPath, ['--import', './tests/fixtures/zhihu-http-fixture.mjs', 'apps/desktop/server.mjs'], {
      windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], env: {...process.env, TRACE_AGENT_ENABLED: '0', TRACE_ZHIHU_ENABLED: '1', TRACE_ZHIHU_FIXTURE: '1',
        TRACE_DESKTOP_PORT: String(port), TRACE_WEB_STATE_FILE: path.join(dir, 'web.sqlite'), ZHIHU_ACCESS_SECRET: 'fixture-only',
        ZHIHU_OAUTH_APP_ID: '669', ZHIHU_OAUTH_APP_KEY: 'fixture-key-only', ZHIHU_OAUTH_REDIRECT_URI: `${origin}/callback`},
    });
    let log = ''; child.stdout.on('data', x => {log += x;}); child.stderr.on('data', x => {log += x;});
    let browser;
    t.after(async () => {
      await browser?.close();
      if (child.exitCode === null && child.signalCode === null) {const done = once(child, 'close'); child.kill(); await done;}
      assert.equal(path.dirname(dir), path.resolve(os.tmpdir())); assert.ok(path.basename(dir).startsWith('trace-zhihu-web-'));
      fs.rmSync(dir, {recursive: true, force: true, maxRetries: 5, retryDelay: 100});
    });
    for (let i = 0; i < 150 && !log.includes('Trace Web:'); i++) {assert.equal(child.exitCode, null, log); await new Promise(r => setTimeout(r, 100));}
    assert.match(log, /Trace Web:/);
    browser = await chromium.launch({headless: true, ...(process.env.TRACE_BROWSER_CHANNEL ? {channel: process.env.TRACE_BROWSER_CHANNEL} : {})});
    const context = await browser.newContext({viewport: {width: 1440, height: 1000}}), page = await context.newPage(), errors = [];
    page.on('pageerror', e => errors.push(e.message));
    // Intercept the redirect source. Call the actual connect handler and
    // preserve its cookie; never navigate to the live authorization platform.
    await context.route(origin + '/api/zhihu/oauth/connect*', async route => {
      const connected = await route.fetch({maxRedirects: 0}); assert.equal(connected.status(), 303);
      const headers = {...connected.headers()}, request = new URL(headers.location), callback = new URL(request.searchParams.get('redirect_uri'));
      callback.search = new URLSearchParams({state: request.searchParams.get('state'), authorization_code: 'fixture-code-only'}).toString();
      delete headers.location; headers['content-type'] = 'text/html; charset=utf-8';
      return route.fulfill({status: 200, headers, body: `<html><title>测试授权</title><a href="${callback.href.replaceAll('&', '&amp;')}">确认测试授权</a></html>`});
    });
    await page.goto(origin, {waitUntil: 'networkidle'});
    const before = await (await fetch(origin + '/api/product/workspace')).json();
    await page.getByRole('button', {name: /个人|设置/}).first().click();
    await page.getByRole('button', {name: '知乎与全网 · 检索和授权'}).click();
    const dialog = page.getByRole('dialog', {name: '知乎与全网，找一份对照'});
    await dialog.getByText('已连接本机知乎接口 · 只发送你输入的查询').waitFor();
    const search = dialog.getByRole('button', {name: '搜索 3 条来源'}), query = dialog.getByRole('textbox', {name: '想找什么'});
    await query.fill('第一次带团队'); await search.click();
    await dialog.getByRole('heading', {name: '知乎 · 受控接口测试'}).waitFor();
    assert.equal(await dialog.locator('article img').count(), 0); assert.equal(await page.evaluate(() => window.__unsafe), undefined);
    assert.equal(await dialog.getByRole('link', {name: '查看原文 ↗'}).getAttribute('href'), 'https://www.zhihu.com/question/1/answer/2?utm_source=trace');
    await dialog.getByLabel('到哪里找').selectOption('global'); await search.click();
    await dialog.getByRole('heading', {name: '全网 · 受控接口测试'}).waitFor();
    await query.fill('空结果测试'); await search.click(); await dialog.getByText(/这次没有返回内容/).waitFor(); assert.equal(await dialog.locator('article').count(), 0);
    await dialog.getByText('连接我的知乎', {exact: true}).click(); await dialog.getByRole('button', {name: '去知乎授权'}).click();
    const popupPromise = page.waitForEvent('popup'); await dialog.getByRole('link', {name: '打开知乎授权页面 ↗'}).click();
    const popup = await popupPromise; await popup.waitForLoadState('domcontentloaded');
    t.diagnostic(JSON.stringify({authorizationPage: popup.url().split('?')[0], text: (await popup.textContent('body')).slice(0, 500)}));
    await popup.getByRole('link', {name: '确认测试授权'}).click(); await popup.waitForURL(origin + '/api/zhihu/oauth/result');
    assert.ok(!(await popup.textContent('body')).includes('fixture-code')); await popup.close();
    await dialog.getByRole('button', {name: '我已授权，检查连接'}).click(); await dialog.getByText('当前本机已授权；尚未自动读取任何收藏。').waitFor();
    await dialog.getByRole('button', {name: '读取近期收藏 3 条'}).click(); await dialog.getByRole('heading', {name: '近期收藏 · 受控接口测试'}).waitFor();
    if (process.env.TRACE_BROWSER_ARTIFACTS) {
      fs.mkdirSync(process.env.TRACE_BROWSER_ARTIFACTS, {recursive: true});
      await page.screenshot({path: path.join(process.env.TRACE_BROWSER_ARTIFACTS, 'zhihu-fixture-desktop.png')});
    }
    await page.setViewportSize({width: 390, height: 844});
    const bounds = await dialog.boundingBox(); assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= 391);
    assert.equal(await dialog.evaluate(el => el.scrollWidth > el.clientWidth), false);
    await dialog.getByRole('button', {name: '断开本机连接'}).click(); await dialog.getByText('当前没有有效的知乎授权连接。').waitFor();
    assert.equal(await dialog.getByRole('button', {name: '读取近期收藏 3 条'}).isDisabled(), true);
    if (process.env.TRACE_BROWSER_ARTIFACTS) await page.screenshot({path: path.join(process.env.TRACE_BROWSER_ARTIFACTS, 'zhihu-fixture-mobile.png')});
    await query.fill('限流测试'); await search.click(); await dialog.getByText('知乎暂时限流。请稍后再试，不会自动重复请求。').waitFor();
    assert.equal(await dialog.locator('article').count(), 0); await page.keyboard.press('Escape'); assert.equal(await dialog.count(), 0);
    const after = await (await fetch(origin + '/api/product/workspace')).json(); assert.equal(after.revision, before.revision); assert.deepEqual(after.host, before.host);
    assert.deepEqual(errors, []); t.diagnostic('Real desktop HTTP and browser; Zhihu upstream simulated. No live credentials/API quota used.');
  });
