import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import net from 'node:net';
import {once} from 'node:events';
import {spawn} from 'node:child_process';
import {createRequire} from 'node:module';

const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function port(){const server=net.createServer();server.listen(0,'127.0.0.1');await once(server,'listening');const value=server.address().port;await new Promise(resolve=>server.close(resolve));return value;}

test('browser: Agent answer is rendered and an exact revision candidate needs explicit accept/undo',
  {skip:process.env.TRACE_BROWSER_TESTS!=='1',timeout:90000},async t=>{
  const {chromium}=createRequire(import.meta.url)(process.env.TRACE_PLAYWRIGHT_MODULE||'playwright');
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'trace-agent-web-')),desktopPort=await port();
  const model=http.createServer(async(req,res)=>{let raw='';req.setEncoding('utf8');for await(const chunk of req)raw+=chunk;const body=JSON.parse(raw);
    assert.ok(Array.isArray(body.messages)&&body.messages.length>=2);
    res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({choices:[{message:{role:'assistant',content:JSON.stringify({answer:'建议只改用户选中的范围。',replacement:'接口与页面形成可确认闭环',citations:[],uncertainties:['仍需真实使用结果。']})}}]}));});
  model.listen(0,'127.0.0.1');await once(model,'listening');
  const profiles=path.join(dir,'profiles.json');fs.writeFileSync(profiles,JSON.stringify({protocolVersion:1,configVersion:1,ownerId:'agent-web-test',defaultProfileId:'fixture',profiles:[{id:'fixture',kind:'model',enabled:true,version:1,endpoint:`http://127.0.0.1:${model.address().port}/v1/chat/completions`,model:'fixture'}]}));
  const child=spawn(process.execPath,['apps/desktop/server.mjs'],{windowsHide:true,stdio:['ignore','pipe','pipe'],shell:false,cwd:path.resolve('.'),env:{...process.env,TRACE_DESKTOP_PORT:String(desktopPort),TRACE_WEB_STATE_FILE:path.join(dir,'web.sqlite'),TRACE_AGENT_STATE_FILE:path.join(dir,'agent.sqlite'),TRACE_AGENT_PROFILES_FILE:profiles,TRACE_AGENT_ENABLED:'1',TRACE_ZHIHU_ENABLED:'0'}});
  let log='';child.stdout.on('data',x=>{log+=x;});child.stderr.on('data',x=>{log+=x;});let browser;
  t.after(async()=>{await browser?.close();if(child.exitCode===null&&child.signalCode===null){const done=once(child,'close');child.kill();await done;}model.closeAllConnections();await new Promise(resolve=>model.close(resolve));fs.rmSync(dir,{recursive:true,force:true,maxRetries:5,retryDelay:100});});
  const origin=`http://127.0.0.1:${desktopPort}`;for(let i=0;i<150&&!log.includes('Trace Web:');i++){assert.equal(child.exitCode,null,log);await delay(50);}assert.match(log,/Trace Web:/);
  const command=await fetch(origin+'/api/product/commands',{method:'POST',headers:{origin,'content-type':'application/json'},body:JSON.stringify({protocolVersion:1,commandId:'agent-web-create',expectedRevision:0,operations:[{type:'capture.create',matterId:'m',text:'Agent 接入不应绕过我的确认。'},{type:'chain.action',matterId:'m',action:{type:'UNDERSTANDING_DRAFT',text:'接口与页面需要形成闭环。'}},{type:'chain.action',matterId:'m',action:{type:'SAVE_UNDERSTANDING'}}]})});assert.equal(command.status,200);
  browser=await chromium.launch({headless:true,...(process.env.TRACE_BROWSER_CHANNEL?{channel:process.env.TRACE_BROWSER_CHANNEL}:{})});const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(`${origin}/?view=chain&matter=m&screen=understanding`,{waitUntil:'networkidle'});
  const editor=page.locator('[data-selection="understanding"]');await editor.waitFor();const selected='接口与页面需要形成闭环';
  await editor.evaluate((element,end)=>{element.focus();element.setSelectionRange(0,end);element.dispatchEvent(new Event('select',{bubbles:true}));},selected.length);
  await page.getByRole('button',{name:'问 Agent'}).click();const dialog=page.getByRole('dialog',{name:'问 Agent，继续分清'});await dialog.getByText(/Agent Runtime 已启用/).waitFor();
  await dialog.getByLabel('怎么帮助').selectOption('revise');await dialog.getByLabel('这次想问什么').fill('帮我缩短选中的这一处。');await dialog.getByRole('button',{name:'开始'}).click();
  await delay(2000);
  await dialog.getByRole('heading',{name:'Agent 给出了一处修改候选'}).waitFor({timeout:10000});assert.equal(await dialog.getByText('接口与页面形成可确认闭环').count(),1);
  const beforeAdoption=await (await fetch(origin+'/api/product/workspace')).json();
  await dialog.getByRole('button',{name:'接受这一处'}).click();await dialog.getByText(/候选已应用到草稿/).waitFor();
  let workspace=await (await fetch(origin+'/api/product/workspace')).json();assert.equal(workspace.revision,beforeAdoption.revision+1);assert.equal(workspace.host.chain.matters[0].understanding,'接口与页面需要形成闭环。');assert.equal(workspace.host.chain.matters[0].understandingDraft,'接口与页面形成可确认闭环。');
  await dialog.getByRole('button',{name:'撤销这次采纳'}).click();await dialog.getByText(/这次采纳已撤销/).waitFor();workspace=await (await fetch(origin+'/api/product/workspace')).json();assert.equal(workspace.revision,beforeAdoption.revision+2);assert.equal(workspace.host.chain.matters[0].understandingDraft,'接口与页面需要形成闭环。');
  assert.deepEqual(errors,[]);t.diagnostic('Real desktop HTTP + browser + controlled model: selection, SSE result, explicit adoption and undo.');
});
