import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {applyProductOperations} from './commands.mjs';
import {effectiveContentReferences,stableWorkbenchJson,resolveContentRef} from './workbench-model.mjs';

const plain=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
const text=(x,n=65536)=>typeof x==='string'&&x.length<=n&&!x.includes('\0');
const identity=x=>text(x,200)&&x.trim()&&!/[\x00-\x1f\x7f]/.test(x)&&!['__proto__','constructor','prototype'].includes(x);
const exact=(x,keys)=>plain(x)&&Object.keys(x).every(k=>keys.includes(k));
const sha=x=>crypto.createHash('sha256').update(x).digest('hex');
const digest=x=>typeof x==='string'&&/^[a-f0-9]{64}$/.test(x);
const keyOf=p=>process.platform==='win32'?p.toLowerCase():p;
const now=()=>new Date().toISOString();
const copy=x=>structuredClone(x);
const signedKinds=new Set(['prepare','request','receive','return']);
export const TASK_HANDOFF_PREFIX='/api/product/task-handoffs/';
export const taskHandoffPath=pathname=>pathname.startsWith(TASK_HANDOFF_PREFIX)?pathname.slice(TASK_HANDOFF_PREFIX.length):null;

function localPath(value,need){
  need(text(value,4096)&&path.isAbsolute(value)&&!/[\x00-\x1f\x7f]/.test(value)&&!value.startsWith('\\\\')&&!value.startsWith('//'),'INVALID_PROJECT_DIR','只接受明确的本机绝对项目目录，不访问网络共享。',400);
  return path.normalize(path.resolve(value));
}
function project(value,need){
  const directory=localPath(value,need);let real;
  try{need(fs.statSync(directory).isDirectory(),'INVALID_PROJECT_DIR','项目路径必须是目录。',400);real=fs.realpathSync.native(directory);}
  catch(error){if(error.code==='INVALID_PROJECT_DIR')throw error;need(false,'INVALID_PROJECT_DIR','项目目录不存在或不可访问。',400);}
  localPath(real,need);return {projectDir:directory,projectIdentity:keyOf(real)};
}
function hostProject(body,need){
  const proof=body.host;
  need(exact(proof,['rootUri','clientName','observedAt'])&&text(proof.rootUri,4096)&&text(proof.clientName,200)&&typeof proof.observedAt==='string'&&Number.isFinite(Date.parse(proof.observedAt))&&Math.abs(Date.now()-Date.parse(proof.observedAt))<120000,'HOST_PROJECT_UNVERIFIED','缺少本次宿主允许根的明确报告；没有交付正文。',409);
  let url,directory;
  try{url=new URL(proof.rootUri);need(url.protocol==='file:'&&!url.hostname&&!url.search&&!url.hash&&!url.username&&!url.password,'HOST_PROJECT_UNVERIFIED','宿主根必须是本机file URI，不访问网络路径。',409);directory=fileURLToPath(url);}
  catch{need(false,'HOST_PROJECT_UNVERIFIED','宿主根不是可核对的本机file URI。',409);}
  const selected=project(body.projectDir,need),reported=project(directory,need);
  need(selected.projectIdentity===reported.projectIdentity,'PROJECT_MISMATCH','指定目录与宿主报告的唯一允许根不一致，没有交付正文。',409);
  return {...selected,rootUri:url.href,clientName:proof.clientName};
}
function loadKey(file,need){
  need(path.isAbsolute(file),'INVALID_BRIDGE_KEY','桥接密钥文件必须由宿主明确配置。',500);
  if(!fs.existsSync(file)){
    const value={ownerId:crypto.randomUUID(),key:crypto.randomBytes(32).toString('hex')};
    try{fs.writeFileSync(file,JSON.stringify(value)+'\n',{flag:'wx',mode:0o600});}catch(error){if(error.code!=='EEXIST')throw error;}
  }
  const stat=fs.lstatSync(file);need(stat.isFile()&&!stat.isSymbolicLink()&&stat.size<1024,'INVALID_BRIDGE_KEY','桥接密钥身份不正确，未替换或回退。',503);
  const value=JSON.parse(fs.readFileSync(file,'utf8'));
  need(exact(value,['ownerId','key'])&&identity(value.ownerId)&&digest(value.key),'INVALID_BRIDGE_KEY','桥接密钥不可读，未自动替换或回退。',503);
  return value;
}
function returnText(payload){
  const sections=[['报告的事实与证据',payload.fact],['摘要',payload.summary],['解释',payload.interpretation],['未确定处',payload.unconfirmed],['候选理解（尚未采用）',payload.proposedUnderstanding]];
  if(payload.artifacts?.length)sections.push(['产物描述（未自动读取文件）',JSON.stringify(payload.artifacts,null,2)]);
  return sections.filter(([,value])=>value!==undefined&&value!=='').map(([title,value])=>'## '+title+'\n'+value).join('\n\n');
}

// One Product owner, one command ledger and one SQLite transaction. The key
// authenticates this configured bridge, not the host's claim of "current task".
export function createTaskHandoff({file,keyFile,db,need,transaction,currentRevision,readSnapshot,persist,preparedTaskInput,assertNoNativeAttempt}){
  need(path.dirname(path.resolve(keyFile))===path.dirname(file),'INVALID_BRIDGE_KEY','桥接密钥必须保留在该内容owner的受控目录。',500);
  const key=loadKey(keyFile,need);
  const lookup=id=>db.prepare('SELECT request_sha256,committed_revision FROM web_commands WHERE command_id=?').get(id);
  const receipt=(kind,commandId,known)=>{
    const row=known.request_sha256?known:lookup(commandId);
    need(row?.request_sha256.startsWith('task-handoff-v2:'+kind+':'),'STORAGE_CORRUPT','原交接回执不可核对。',503);
    return {protocolVersion:2,kind,commandId,status:'committed',requestHash:row.request_sha256.slice(('task-handoff-v2:'+kind+':').length),beforeRevision:row.committed_revision-1,afterRevision:row.committed_revision};
  };
  const taskOf=(host,id)=>{const task=host?.schemaVersion===2&&host.tasks[id];need(task,'TASK_NOT_FOUND','没有这个明确任务；不会从另一内容库或同名项目中猜取。',404);return task;};
  const handoffOf=task=>task.handoff??={requests:[],returns:[]};
  const claimOf=(task,body)=>{const claim=task.dispatch;need(claim?.source==='codex'&&claim.ownerId===key.ownerId&&claim.sessionId===body.sessionId&&claim.deliveryId===body.deliveryId&&claim.inputHash===body.contextHash,'HANDOFF_MISMATCH','返回或领取不属于这份原始交接，未写入或发送内容。',409);need(keyOf(localPath(body.projectDir,need))===keyOf(claim.projectDir),'PROJECT_MISMATCH','请使用原交付回执中的项目目录；未改投其它项目。',409);return claim;};
  function validate(kind,body){
    const fields={prepare:['title','goal','refs','excluded','instructions','intentId'],request:[],receive:['deliveryId','contextHash'],return:['deliveryId','contextHash','returnId','payload'],preview:['requestId'],approve:['requestId','projectDir','expectedInputHash'],reject:['requestId'],revoke:['dispatchId'],review:['returnId','decision','note']};
    need(Object.hasOwn(fields,kind),'NOT_FOUND','没有这个任务交接动作。',404);
    const common=['protocolVersion','commandId',...(kind==='prepare'?[]:['taskId']),...(signedKinds.has(kind)?['sessionId','projectDir',...(kind==='return'?[]:['host'])]:['expectedRevision'])];
    need(exact(body,[...common,...fields[kind]])&&body.protocolVersion===2&&identity(body.commandId)&&(kind==='prepare'||identity(body.taskId)),'INVALID_TASK_HANDOFF','需要明确的协议2任务动作，不接受旧workId、matterId或自报已验证字段。',400);
    if(signedKinds.has(kind))need(identity(body.sessionId)&&text(body.projectDir,4096),'INVALID_TASK_HANDOFF','宿主会话或项目身份不正确。',400);
    else need(Number.isSafeInteger(body.expectedRevision)&&body.expectedRevision>=0,'INVALID_TASK_HANDOFF','需要明确的工作区基准。',400);
    if(['preview','approve','reject'].includes(kind))need(identity(body.requestId),'INVALID_TASK_HANDOFF','需要明确的接续申请。',400);
    if(['receive','return'].includes(kind))need(identity(body.deliveryId)&&digest(body.contextHash),'INVALID_TASK_HANDOFF','需要原交付身份和输入指纹。',400);
    if(kind==='revoke')need(identity(body.dispatchId),'INVALID_TASK_HANDOFF','需要原外部派发身份。',400);
    if(kind==='approve')need(digest(body.expectedInputHash),'INVALID_TASK_HANDOFF','先核对本次实际输入。',400);
    if(kind==='prepare')need(identity(body.intentId)&&text(body.title,200)&&body.title.trim()&&text(body.goal)&&body.goal.trim()&&Array.isArray(body.refs)&&Array.isArray(body.excluded)&&Array.isArray(body.instructions),'INVALID_TASK_HANDOFF','准备需要明确问题、标题和引用范围。',400);
    if(kind==='return'){
      const p=body.payload;
      need(identity(body.returnId)&&exact(p,['fact','summary','interpretation','unconfirmed','proposedUnderstanding','artifacts'])&&text(p.fact)&&p.fact.trim()&&['summary','interpretation','unconfirmed','proposedUnderstanding'].every(k=>p[k]===undefined||text(p[k]))&&(p.artifacts===undefined||Array.isArray(p.artifacts)&&p.artifacts.length<=20&&p.artifacts.every(a=>exact(a,['title','kind','path','url','digest'])&&text(a.title,1000)&&a.title.trim()&&['file','test','link','note'].includes(a.kind)&&['path','url','digest'].every(k=>a[k]===undefined||text(a[k],k==='digest'?512:4096))))&&Buffer.byteLength(stableWorkbenchJson(p))<=256*1024,'INVALID_TASK_RETURN','返回必须有界并区分报告事实、解释和未确定处；没有写入损坏或超大原稿。',400);
    }
    if(kind==='review')need(identity(body.returnId)&&['kept','needs_work','rejected'].includes(body.decision)&&text(body.note,16000),'INVALID_TASK_HANDOFF','需要明确原返回和本次复核决定。',400);
  }
  function authenticate(kind,body,headers){
    if(!signedKinds.has(kind))return;
    const owner=headers?.['x-trace-task-owner'],signature=headers?.['x-trace-task-signature'];
    need(owner===key.ownerId&&digest(signature),'BRIDGE_AUTH_REQUIRED','该任务需要明确配置的本机桥接身份；未使用旧服务或无签名回退。',403);
    const expected=crypto.createHmac('sha256',Buffer.from(key.key,'hex')).update('trace-task-v2\nPOST\n'+TASK_HANDOFF_PREFIX+kind+'\n'+key.ownerId+'\n'+stableWorkbenchJson(body)).digest();
    need(crypto.timingSafeEqual(expected,Buffer.from(signature,'hex')),'BRIDGE_AUTH_REQUIRED','桥接签名与本次完整动作不一致，没有读取或写入内容。',403);
  }
  function render(kind,body,known,head){
    const task=taskOf(readSnapshot(known.committed_revision).host,kind==='prepare'?'task-external-'+sha(key.ownerId+'\0'+body.sessionId+'\0'+body.intentId).slice(0,40):body.taskId);
    const common={protocolVersion:2,taskId:task.id,receipt:receipt(kind,body.commandId,known),headRevision:head};
    if(kind==='prepare')return {...common,prepared:true,dispatched:false};
    if(kind==='request'){
      const request=task.handoff.requests.find(r=>r.commandId===body.commandId),current=taskOf(readSnapshot(head).host,task.id),claim=current.dispatch;
      return {...common,request:copy(current.handoff.requests.find(r=>r.id===request.id)),includesContent:false,...(claim?.source==='codex'&&claim.requestId===request.id&&claim.ownerId===key.ownerId?{grant:{deliveryId:claim.deliveryId,contextHash:claim.inputHash,revoked:Boolean(claim.revokedAt||claim.cancelledAt)}}:{})};
    }
    if(kind==='receive'){
      // A recovered receipt does not re-enable a source that is inactive now.
      const current=taskOf(readSnapshot(head).host,task.id),claim=current.dispatch;
      need(claim?.source==='codex'&&!claim.revokedAt&&!claim.cancelledAt&&claim.ownerId===key.ownerId,'HANDOFF_REVOKED','外部引用许可已撤销；历史回执仍保留，没有重新交付。',409);
      const input=preparedTaskInput(readSnapshot(head).host,task.id);
      return {...common,delivery:{id:claim.deliveryId,contextHash:claim.inputHash,sessionId:claim.sessionId,projectDir:claim.projectDir,rootUri:claim.rootUri,receivedAt:claim.receivedAt},input,execution:'unknown',notice:'仅证明已领取明确范围，不证明模型读过或任务已经执行；文件权限由外部宿主控制。'};
    }
    if(kind==='return'){
      const result=task.handoff.returns.find(r=>r.commandId===body.commandId);
      return {...common,returnId:result.id,resultHash:result.resultHash,source:copy(result.source),review:'pending',adopted:false};
    }
    return {...common,changed:true};
  }
  function execute(kind,body,headers){
    validate(kind,body);authenticate(kind,body,headers);
    return transaction(()=>{
      const revision=currentRevision(),host=readSnapshot(revision).host,known=lookup(body.commandId),fingerprint='task-handoff-v2:'+kind+':'+sha(stableWorkbenchJson(body));
      if(known){need(known.request_sha256===fingerprint,'COMMAND_CONFLICT','同一交接命令不能改成其它输入或结果，原回执保留。',409);if(kind==='receive')hostProject(body,need);return render(kind,body,known,revision);}
      if(!signedKinds.has(kind))need(body.expectedRevision===revision,'REVISION_CONFLICT','工作区已有变化，请保留输入并重新核对。',409);
      if(kind==='prepare'){
        const reported=hostProject(body,need);
        need(!host||host.schemaVersion===2,'LEGACY_WORKSPACE','外部入口不隐式迁移旧库；请先在Trace核对内容owner。',409);
        const id='task-external-'+sha(key.ownerId+'\0'+body.sessionId+'\0'+body.intentId).slice(0,40),inputHash=sha(stableWorkbenchJson({title:body.title,goal:body.goal,refs:body.refs,excluded:body.excluded,instructions:body.instructions})),previous=host?.tasks?.[id];
        if(previous){const p=previous.handoff?.preparation;need(p&&p.ownerId===key.ownerId&&p.sessionId===body.sessionId&&p.intentId===body.intentId&&p.projectIdentity===reported.projectIdentity&&p.inputHash===inputHash,'COMMAND_CONFLICT','同一准备意图已有不同输入，未覆盖或另建任务。',409);const original=lookup(p.commandId);need(original,'STORAGE_CORRUPT','原外部准备回执不可核对。',503);return render(kind,{...body,commandId:p.commandId},original,revision);}
        const next=applyProductOperations(host,[{type:'task.prepare',id,title:body.title,goal:body.goal,refs:body.refs,excluded:body.excluded,instructions:body.instructions,destination:'Codex 外部现场'}]);
        next.tasks[id].handoff={preparation:{commandId:body.commandId,ownerId:key.ownerId,sessionId:body.sessionId,intentId:body.intentId,projectIdentity:reported.projectIdentity,inputHash},requests:[],returns:[]};
        persist(next,fingerprint,body.commandId,revision);return render(kind,body,{committed_revision:revision+1},revision+1);
      }
      let next=copy(host),task=taskOf(next,body.taskId),handoff=handoffOf(task);
      if(kind==='request'){
        const reported=hostProject(body,need);
        need(task.status==='prepared'&&!task.execution,'TASK_UNAVAILABLE','任务已取消或绑定执行，未改投另一任务。',409);
        const previous=handoff.requests.find(r=>r.ownerId===key.ownerId&&r.sessionId===body.sessionId&&r.projectIdentity===reported.projectIdentity&&r.rootUri===reported.rootUri&&r.status!=='rejected');
        if(previous){const original={...body,commandId:previous.commandId},old=lookup(previous.commandId);need(old,'STORAGE_CORRUPT','原申请回执不可核对。',503);return render(kind,original,old,revision);}
        need(!task.dispatch,'TASK_DISPATCH_CONFLICT','任务已有派发归属，不登记第二个执行者。',409);
        need(handoff.requests.length<32,'HANDOFF_LIMIT','该任务的接续申请已达上限；原记录仍保留。',409);
        handoff.requests.push({id:'request-'+crypto.randomUUID(),commandId:body.commandId,ownerId:key.ownerId,sessionId:body.sessionId,...reported,at:now(),status:'pending'});
      }else if(kind==='preview'||kind==='approve'||kind==='reject'){
        const request=handoff.requests.find(r=>r.id===body.requestId);
        need(request&&request.ownerId===key.ownerId,'HANDOFF_REQUEST_UNAVAILABLE','申请不是当前内容owner的有效连接；导入历史不会恢复授权。',409);
        need(task.status==='prepared'&&!task.execution&&!task.dispatch&&request.status==='pending','TASK_DISPATCH_CONFLICT','任务或申请状态已变，先核对原派发，不重复授权。',409);
        if(kind==='reject'){request.status='rejected';request.decidedAt=now();request.decisionCommandId=body.commandId;}
        else {
          const input=preparedTaskInput(host,task.id),inputHash=sha(JSON.stringify(input));
          if(kind==='preview')return {protocolVersion:2,ownerId:key.ownerId,revision,request:copy(request),input,inputHash,preparedInputHash:sha(stableWorkbenchJson(input)),contentDelivered:false};
          const selected=project(body.projectDir,need);
          need(selected.projectIdentity===request.projectIdentity,'PROJECT_MISMATCH','所选项目与申请的真实目录不同，没有授权。',409);
          need(inputHash===body.expectedInputHash,'TASK_INPUT_CHANGED','输入已变化，请重新查看实际范围后确认。',409);
          assertNoNativeAttempt(task.id);
          const id='external-'+sha(body.commandId).slice(0,48);
          task.preparedInputVersion=1;task.dispatch={id,commandId:body.commandId,inputCommandId:body.commandId,source:'codex',requestId:request.id,deliveryId:'delivery-'+crypto.randomUUID(),ownerId:key.ownerId,sessionId:request.sessionId,inputVersion:1,inputHash,preparedInputHash:sha(stableWorkbenchJson(input)),projectDir:request.projectDir,projectIdentity:request.projectIdentity,rootUri:request.rootUri,mode:'external-host',at:now()};
          request.status='approved';request.decidedAt=task.dispatch.at;request.decisionCommandId=body.commandId;
        }
      }else if(kind==='receive'){
        const claim=claimOf(task,body),reported=hostProject(body,need);
        need(!claim.revokedAt&&!claim.cancelledAt&&reported.projectIdentity===claim.projectIdentity&&reported.rootUri===claim.rootUri,'HANDOFF_REVOKED','引用许可或宿主允许根已变化，没有交付内容。',409);
        preparedTaskInput(host,task.id);
        if(claim.receiveCommandId){const original={...body,commandId:claim.receiveCommandId},old=lookup(claim.receiveCommandId);need(old,'STORAGE_CORRUPT','原领取回执不可核对。',503);return render(kind,original,old,revision);}
        claim.receivedAt=now();claim.receiveCommandId=body.commandId;
      }else if(kind==='revoke'){
        const claim=task.dispatch;
        need(claim?.source==='codex'&&claim.ownerId===key.ownerId&&claim.id===body.dispatchId,'HANDOFF_MISMATCH','没有这份原外部派发。',409);
        claim.revokedAt??=now();if(!claim.receivedAt){claim.cancelledAt=claim.revokedAt;task.status='cancelled';}
      }else if(kind==='return'){
        const claim=claimOf(task,body);
        need(claim.receivedAt,'HANDOFF_NOT_RECEIVED','尚无原领取回执，不接成该任务的执行结果。',409);
        need(!handoff.returns.some(r=>r.id===body.returnId),'RETURN_CONFLICT','原返回身份已有不可变内容，未覆盖。',409);
        need(handoff.returns.length<64,'HANDOFF_LIMIT','返回数量已达上限，原稿未覆盖。',409);
        // Historical output reception intentionally does not call hostProject or
        // forUse. Later reads/adoption have a separate current-eligibility gate.
        const locked=preparedTaskInput(host,task.id,{forUse:false});
        need(sha(JSON.stringify(locked))===claim.inputHash&&sha(stableWorkbenchJson(locked))===claim.preparedInputHash,'STORAGE_CORRUPT','原交付输入完整性不一致，未改用其它内容。',503);
        const refs=effectiveContentReferences([...locked.task.refs,...(locked.task.instructions||[]),...(locked.task.template?[locked.task.template]:[])],locked.task.excluded);
        for(const ref of refs)resolveContentRef(host,ref);
        const source={kind:'expression',id:'external-return-'+sha(body.returnId).slice(0,40),version:1};
        next=applyProductOperations(host,[{type:'expression.create',id:source.id,kind:'note',title:'外部 Agent 返回原稿（未独立验证）',author:'agent',value:{text:returnText(body.payload),refs}}],{historicalArchive:true});
        task=taskOf(next,body.taskId);handoff=handoffOf(task);
        handoff.returns.push({id:body.returnId,commandId:body.commandId,deliveryId:claim.deliveryId,contextHash:claim.inputHash,resultHash:sha(stableWorkbenchJson(body.payload)),source,payload:copy(body.payload),at:now()});
      }else if(kind==='review'){
        const result=handoff.returns.find(r=>r.id===body.returnId);
        need(result,'RETURN_UNAVAILABLE','没有这份不可变返回。',404);
        need(!result.review,'RETURN_REVIEWED','该返回已有复核回执；不会覆盖原决定。',409);
        result.review={commandId:body.commandId,decision:body.decision,note:body.note,at:now()};
      }
      persist(next,fingerprint,body.commandId,revision);
      return render(kind,body,{committed_revision:revision+1},revision+1);
    });
  }
  return {execute,readReceipt(commandId){need(identity(commandId),'INVALID_TASK_HANDOFF','交接命令身份不正确。',400);const known=lookup(commandId);if(!known?.request_sha256.startsWith('task-handoff-v2:'))return {known:false};const kind=known.request_sha256.split(':')[1];return {known:true,receipt:receipt(kind,commandId,known)};},configuration(){return {protocolVersion:2,ownerId:key.ownerId,keyFile,notice:'仅在你明确配置的MCP进程中引用此密钥文件；不将密钥内容加入材料、版本包或日志。宿主报告允许根，仍需逐任务人工配对。'};}};
}
