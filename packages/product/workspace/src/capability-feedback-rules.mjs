// Version-bound user feedback. Pure rules; no file, model, or second store.
export function createCapabilityFeedbackRules(v) {
  const {need,strictObject:shape,identity,text,integer,one,list,optional,validContentRef:ref,stableWorkbenchJson:stable,resolveContentRef:resolve,validateReferenceSelection:selectReference,capabilityValue}=v;
  const stamp=x=>typeof x==='string'&&Number.isFinite(Date.parse(x));
  const digest=x=>typeof x==='string'&&/^[a-f0-9]{64}$/.test(x);
  const refs=list(ref,256),capRef=x=>ref(x)&&x.kind==='capability'&&x.version>=1&&!x.anchor;
  const nativeFields={kind:one('native-result'),runId:identity,taskId:identity,inputHash:digest,resultHash:digest};
  const context=x=>shape(x,{kind:one('manual'),note:text})||shape(x,{kind:one('thinking'),id:identity,messageId:identity})||shape(x,{kind:one('task'),id:identity})||shape(x,nativeFields);
  const storedContext=x=>context(x)&&x.kind!=='native-result'||shape(x,{...nativeFields,verifiedAt:stamp,refs,sessionId:optional(identity),messageId:optional(identity)})&&Boolean(x.sessionId)===Boolean(x.messageId);
  const inputFields={title:x=>text(x)&&x.length<=200,facts:text,interpretation:text,scope:text,assessment:one('support','limit','counterexample','undecided'),target:x=>x===null||capRef(x),context,refs,observedAt:stamp};
  const input=x=>shape(x,inputFields)&&Boolean(x.facts.trim());
  const resolution=x=>shape(x,{action:one('open','kept','revised','disabled','withdrawn'),reason:text,ref:x=>x===null||capRef(x),at:stamp})&&(['revised','disabled'].includes(x.action)?Boolean(x.ref):x.ref===null);
  const value=x=>shape(x,{...inputFields,context:storedContext,resolution})&&Boolean(x.facts.trim());
  function sourceRefs(host,source) {
    if(source.kind==='manual')return null;
    if(source.kind==='thinking'){
      const session=host.sessions[source.id],message=session?.messages.find(m=>m.id===source.messageId);need(message,'FEEDBACK_SOURCE_UNAVAILABLE','原讨论消息不可用，没有用当前消息替代。',409);
      return [...session.refs,...(message.instructions||[]),...(message.template?[message.template]:[])].filter(r=>!session.excluded.some(e=>stable(e)===stable(r)));
    }
    if(source.kind==='task'){
      const task=host.tasks[source.id];need(task,'FEEDBACK_SOURCE_UNAVAILABLE','原任务准备不可用，没有用另一任务替代。',409);
      return [...task.refs,...(task.instructions||[]),...(task.template?[task.template]:[])].filter(r=>!task.excluded.some(e=>stable(e)===stable(r)));
    }
    return source.refs;
  }
  function checkSource(host,body) {
    for(const r of body.refs)resolve(host,r);
    if(body.target)resolve(host,body.target);
    const included=sourceRefs(host,body.context);
    if(body.context.kind==='native-result'){
      if(body.context.sessionId){const s=host.sessions[body.context.sessionId];need(s?.messages.some(m=>m.id===body.context.messageId),'FEEDBACK_SOURCE_UNAVAILABLE','已核验运行对应的原消息不可用。',409);}
      else need(host.tasks[body.context.taskId],'FEEDBACK_SOURCE_UNAVAILABLE','已核验运行对应的原任务不可用。',409);
      for(const r of included)resolve(host,r);
    }
    if(included&&body.target)need(included.some(r=>stable(r)===stable(body.target)),'FEEDBACK_VERSION_MISMATCH','该能力的准确版本不在这次冻结来源中；请核对，不自动绑定当前版。',409);
  }
  const inputContext=source=>source.kind==='native-result'?Object.fromEntries(Object.entries(source).filter(([key])=>Object.hasOwn(nativeFields,key))):source;
  function requiresProof(op,host) {
    if(!['feedback.record','feedback.edit'].includes(op.type)||op.value.context.kind!=='native-result')return false;
    const old=host?.feedbacks?.[op.id];return !old||stable(inputContext(old.versions[old.version].context))!==stable(op.value.context);
  }
  function materialize(host,body,old,proof) {
    const next=structuredClone(body);
    if(body.context.kind==='native-result'){
      const previous=old?.versions[old.version].context;
      if(previous?.kind==='native-result'&&stable(inputContext(previous))===stable(body.context))next.context=structuredClone(previous);
      else{need(proof&&stable(inputContext(proof))===stable(body.context)&&storedContext(proof),'FEEDBACK_RESULT_UNVERIFIED','尚未核验这次真实运行及返回；可保留人工观察，但不能伪造已核验来源。',409);next.context=structuredClone(proof);}
    }
    for(const ref of next.refs)if(!old||!current(old).refs.some(prior=>stable(prior)===stable(ref)))selectReference(host,ref);
    next.resolution={action:'open',reason:'',ref:null,at:body.observedAt};checkSource(host,next);return next;
  }
  const current=f=>f.versions[f.version];
  function apply(host,op,{versioned,add,assertVersion,checkRefs,proofs={}}){
    host.feedbacks??={};
    if(op.type==='feedback.record'){const body=materialize(host,op.value,null,proofs[op.id]);add(host,'feedbacks',op.id,versioned(op.id,'capability-feedback',body.title,body,{status:'active'}));return;}
    const item=host.feedbacks[op.id];assertVersion(item,op.expectedVersion);
    if(op.type==='feedback.edit'){
      need(item.status==='active','FEEDBACK_WITHDRAWN','先明确恢复反馈再编辑，不自动恢复。',409);
      const body=materialize(host,op.value,item,proofs[op.id]);item.version++;item.title=body.title;item.versions[item.version]=body;return;
    }
    if(op.type==='feedback.state'){
      need(op.reason.trim(),'FEEDBACK_REASON_REQUIRED','请留下撤回或恢复的原因。');need(op.state==='restored'?item.status==='withdrawn':item.status==='active','INVALID_TRANSITION','反馈状态已经改变，未重复处理。',409);
      const body=structuredClone(current(item));body.resolution={action:op.state==='restored'?'open':'withdrawn',reason:op.reason,ref:null,at:op.at};item.version++;item.versions[item.version]=body;item.status=op.state==='restored'?'active':'withdrawn';return;
    }
    need(item.status==='active','FEEDBACK_WITHDRAWN','已撤回反馈不能作为新的处理依据。',409);need(op.reason.trim(),'FEEDBACK_REASON_REQUIRED','请说明本次处理的原因。');
    const body=structuredClone(current(item));let target=null;
    if(op.action==='keep')need(op.value===undefined&&op.expectedCapabilityVersion===undefined,'INVALID_FEEDBACK_ACTION','仅保留事实不应带入能力写入。');
    else{
      need(body.target,'FEEDBACK_TARGET_UNKNOWN','先明确核对能力及版本；版本不明不写相似能力。',409);target=host.capabilities[body.target.id];assertVersion(target,op.expectedCapabilityVersion);
      need(target.status!=='received'&&target.status!=='disabled','CAPABILITY_INACTIVE','先在能力库明确采用或恢复，再决定处理反馈。',409);
      if(op.action==='revise'){need(capabilityValue(op.value),'INVALID_FEEDBACK_ACTION','修订候选正文不完整。');checkRefs(host,op.value.refs);target.version++;target.title=op.value.title;target.versions[target.version]=structuredClone(op.value);target.status='draft';}
      else{need(op.value===undefined,'INVALID_FEEDBACK_ACTION','停用不应暗中修改正文。');target.status='disabled';}
      target.changes.push({version:target.version,reason:op.reason,...(op.action==='disable'?{state:'disabled'}:{}),feedback:{id:item.id,version:item.version+1,sourceVersion:body.target.version}});
    }
    body.resolution={action:op.action==='keep'?'kept':op.action==='revise'?'revised':'disabled',reason:op.reason,ref:target?{kind:'capability',id:target.id,version:target.version}:null,at:op.at};item.version++;item.versions[item.version]=body;
  }
  const change=c=>shape(c,{version:integer,reason:text,state:optional(one('disabled')),feedback:x=>shape(x,{id:identity,version:n=>integer(n)&&n>=1,sourceVersion:n=>integer(n)&&n>=1})});
  function validate(host){
    for(const [id,f]of Object.entries(host.feedbacks||{})){
      need(shape(f,{id:identity,kind:one('capability-feedback'),title:text,version:n=>integer(n)&&n>=1,versions:x=>x&&typeof x==='object'&&!Array.isArray(x),status:one('active','withdrawn')})&&f.id===id&&Object.hasOwn(f.versions,String(f.version))&&value(current(f)),'INVALID_FEEDBACK','反馈身份或版本不正确。');
      need(f.title===current(f).title&&Object.keys(f.versions).length===f.version&&(f.status==='withdrawn')===(current(f).resolution.action==='withdrawn'),'INVALID_FEEDBACK','反馈当前状态、标题或历史版本缺失。');
      for(const [n,b]of Object.entries(f.versions)){need(/^[1-9]\d*$/.test(n)&&Number(n)<=f.version&&value(b),'INVALID_FEEDBACK','反馈正文或来源格式无效。');checkSource(host,b);if(b.resolution.ref)resolve(host,b.resolution.ref);}
    }
    for(const c of Object.values(host.capabilities))for(const e of c.changes)if(e.feedback){const f=host.feedbacks?.[e.feedback.id],b=f?.versions[e.feedback.version];need(b&&b.target?.id===c.id&&b.target.version===e.feedback.sourceVersion&&b.resolution.ref?.id===c.id&&b.resolution.ref.version===e.version&&(e.state==='disabled'?b.resolution.action==='disabled':b.resolution.action==='revised'),'INVALID_FEEDBACK','能力变更缺少对应准确反馈版本。');}
  }
  return {input,value,context,inputContext,sourceRefs,requiresProof,apply,change,validate};
}
