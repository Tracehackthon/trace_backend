// Pure packet/receipt rules. Product supplies its existing validators and
// resolver; this module never owns storage, files, execution or another body.
export function createCapabilityPacketRules(v) {
  const {need,strictObject:shape,identity,text,integer,one,list,optional,resource,origin,ink,capabilityValue,validContentRef:ref,stableWorkbenchJson:stable,resolveContentRef:resolve,tree}=v;
  const stamp=x=>typeof x==='string'&&Number.isFinite(Date.parse(x));
  const person=x=>typeof x==='string'&&x.trim().length>0&&x.length<=200&&!/[\x00-\x1f\x7f]/.test(x);
  const source=x=>shape(x,{ref,kind:one('text','dialogue','code','image','audio','video','web','pdf','ink','note','annotation','question','understanding','capability'),title:text,excerpt:text,author:optional(one('user','agent')),origin:optional(origin),original:optional(resource),ink:optional(ink)})&&(x.ref.kind==='material'?['text','dialogue','code','image','audio','video','web','pdf','ink'].includes(x.kind):x.ref.kind==='expression'?['note','annotation','question','understanding','ink'].includes(x.kind):x.kind==='capability');
  const validManifest=x=>shape(x,{format:one('trace.capability.packet'),version:one(1),packetId:identity,createdAt:stamp,sender:person,recipient:person,capability:c=>shape(c,{ref:r=>ref(r)&&r.kind==='capability'&&r.version>=1,value:capabilityValue,sourceStatus:one('draft','trial','published','disabled','received'),sourceRefCount:integer,omittedFields:list(one('evidence','examples','prompt'),3)}),sources:list(source,256),resources:list(resource,64)});
  function validate(manifest) {
    tree(manifest);need(validManifest(manifest),'INVALID_CAPABILITY_PACKET','版本包格式、声明身份、字段或版本无效。');
    need(new Set(manifest.sources.map(s=>stable(s.ref))).size===manifest.sources.length,'INVALID_CAPABILITY_PACKET','版本包包含重复来源。');
    need(new Set(manifest.resources.map(r=>r.id)).size===manifest.resources.length,'INVALID_CAPABILITY_PACKET','版本包包含重复原件。');
    need(new Set(manifest.capability.omittedFields).size===manifest.capability.omittedFields.length&&manifest.capability.sourceRefCount>=manifest.capability.value.refs.length,'INVALID_CAPABILITY_PACKET','省略范围或来源数量无效。');
    for(const field of manifest.capability.omittedFields)need(!manifest.capability.value[field],'INVALID_CAPABILITY_PACKET','标为未分享的字段不能暗中包含正文。');
    need(!manifest.capability.omittedFields.includes('prompt')||!['instruction','template'].includes(manifest.capability.value.usage),'INVALID_CAPABILITY_PACKET','指令和模板的核心正文不能省略。');
    need(stable(manifest.capability.value.refs)===stable(manifest.sources.map(s=>s.ref)),'INVALID_CAPABILITY_PACKET','来源引用必须与明确携带的片段逐一对应。');
    for(const source of manifest.sources)need(manifest.capability.value.refs.some(r=>stable(r)===stable(source.ref)),'INVALID_CAPABILITY_PACKET','版本包带入了未明确引用的来源。');
    for(const r of manifest.resources)need(manifest.sources.some(s=>s.original&&stable(s.original)===stable(r)),'INVALID_CAPABILITY_PACKET','版本包带入了未选择来源的原件。');
    return manifest;
  }
  function prepare(host,{ref:chosen,packetId,createdAt,sender,recipient,sourceRefs=[],originalIds=[],omittedFields=[]}) {
    const {item,value}=resolve(host,chosen);need(chosen.kind==='capability'&&!chosen.anchor,'INVALID_CAPABILITY_PACKET','请选择一个完整、准确的能力版本。');
    need(Array.isArray(sourceRefs)&&sourceRefs.length<=256&&Array.isArray(originalIds)&&new Set(originalIds).size===originalIds.length,'INVALID_CAPABILITY_PACKET','分享范围无效。');
    const sources=sourceRefs.map(ref=>{
      need(value.refs.some(r=>stable(r)===stable(ref)),'INVALID_CAPABILITY_PACKET','分享来源不在这个能力版本的明确引用内。');
      const {item:source,value:body}=resolve(host,ref);let excerpt=ref.kind==='capability'?(['instruction','template'].includes(body.usage)?body.prompt||'':body.steps):body.text;
      if(ref.anchor?.type==='text')excerpt=excerpt.slice(ref.anchor.start,ref.anchor.end);
      const located=body.origin?structuredClone(body.origin):ref.anchor?{kind:'manual'}:undefined;
      if(located?.locator?.type==='text'&&ref.anchor?.type==='text')located.locator={type:'text',start:located.locator.start+ref.anchor.start,end:located.locator.start+ref.anchor.end};
      if(located&&ref.anchor&&ref.anchor.type!=='text')located.locator=structuredClone(ref.anchor);
      const original=body.resourceId?host.resources[body.resourceId]:undefined;
      return {ref:structuredClone(ref),kind:source.kind,title:ref.kind==='capability'?body.title:source.title,excerpt,...(source.author?{author:source.author}:{}),...(located?{origin:located}:{}),...(original?{original:structuredClone(original)}:{}),...(body.ink?{ink:structuredClone(body.ink)}:{})};
    });
    const resources=originalIds.map(id=>{const s=sources.find(s=>s.original?.id===id);need(s,'INVALID_CAPABILITY_PACKET','原件必须由明确勾选的来源带入。');return structuredClone(s.original);});
    const shared=structuredClone(value);shared.refs=structuredClone(sourceRefs);for(const field of omittedFields){need(['evidence','examples','prompt'].includes(field),'INVALID_CAPABILITY_PACKET','不能省略核心方法字段。');shared[field]='';}
    return validate({format:'trace.capability.packet',version:1,packetId,createdAt,sender,recipient,capability:{ref:structuredClone(chosen),value:shared,sourceStatus:item.status,sourceRefCount:value.refs.length,omittedFields:structuredClone(omittedFields)},sources,resources});
  }
  const transfer=t=>shape(t,{direction:one('outgoing','incoming'),packetResourceId:x=>typeof x==='string'&&/^[a-f0-9]{64}$/.test(x),packetId:identity,createdAt:stamp,sender:person,recipient:person,source:r=>ref(r)&&r.kind==='capability'&&r.version>=1,omittedFields:list(one('evidence','examples','prompt'),3)});
  const change=c=>shape(c,{version:integer,reason:text,state:optional(one('trial','published','disabled','restored','adopted')),transfer:optional(transfer)})&&!(c.transfer&&c.state);
  const event=(manifest,packetResourceId,direction)=>({direction,packetResourceId,packetId:manifest.packetId,createdAt:manifest.createdAt,sender:manifest.sender,recipient:manifest.recipient,source:structuredClone(manifest.capability.ref),omittedFields:structuredClone(manifest.capability.omittedFields)});
  function received(host,packetResourceId){return Object.values(host.capabilities).find(c=>c.changes.some(e=>e.transfer?.direction==='incoming'&&e.transfer.packetResourceId===packetResourceId));}
  function checkPacketId(host,manifest,packetResourceId){for(const c of Object.values(host.capabilities))for(const e of c.changes)if(e.transfer?.packetId===manifest.packetId)need(e.transfer.packetResourceId===packetResourceId,'PACKET_ID_CONFLICT','同一版本包ID已对应不同内容；未覆盖。',409);}
  function applyExport(host,op) {
    const item=host.capabilities[op.id];need(item&&item.version===op.expectedVersion,'CONTENT_CONFLICT','能力已有新版本；保留准备范围后重新核对。',409);
    need(op.manifest.capability.ref.id===op.id,'INVALID_CAPABILITY_PACKET','包与导出对象不一致。');
    const expected=prepare(host,{...op.manifest,ref:op.manifest.capability.ref,sourceRefs:op.manifest.sources.map(s=>s.ref),originalIds:op.manifest.resources.map(r=>r.id),omittedFields:op.manifest.capability.omittedFields});
    need(stable(expected)===stable(op.manifest),'PACKET_CONTENT_CONFLICT','包内容与所选保存版本不一致。',409);checkPacketId(host,op.manifest,op.packetResourceId);
    need(host.resources[op.packetResourceId],'RESOURCE_UNAVAILABLE','版本包原件尚未保存。',409);
    if(!item.changes.some(e=>e.transfer?.direction==='outgoing'&&e.transfer.packetResourceId===op.packetResourceId))item.changes.push({version:op.manifest.capability.ref.version,reason:'准备明确版本包，未确认送达',transfer:event(op.manifest,op.packetResourceId,'outgoing')});
  }
  function applyReceive(host,op,{versioned,add,assertVersion}) {
    validate(op.manifest);checkPacketId(host,op.manifest,op.packetResourceId);need(!received(host,op.packetResourceId),'PACKET_ALREADY_RECEIVED','这个包已接收，请打开已有条目；没有重复创建。',409);
    need(host.resources[op.packetResourceId],'RESOURCE_UNAVAILABLE','版本包原件尚未保存。',409);
    const target=op.mode==='update'?host.capabilities[op.id]:null;
    if(op.mode==='update'){
      assertVersion(target,op.expectedVersion);need(target.status!=='disabled'&&target.status!=='received','CAPABILITY_INACTIVE','先明确采用或恢复本地能力，再决定更新。',409);
      const previous=target.changes.filter(e=>e.transfer?.direction==='incoming'&&e.transfer.source.id===op.manifest.capability.ref.id);
      need(previous.length&&op.manifest.capability.ref.version>Math.max(...previous.map(e=>e.transfer.source.version)),'PACKET_UPDATE_CONFLICT','更新必须来自相同来源身份的更高版本；旧版或同版不能倒退覆盖。',409);
    }else need(op.expectedVersion===undefined,'INVALID_CAPABILITY_PACKET','另存不能带入更新版本条件。');
    const refs=op.manifest.sources.map((s,index)=>{
      const id='shared-'+op.packetResourceId.slice(0,32)+'-'+index,original=s.original&&op.manifest.resources.find(r=>r.id===s.original.id);
      if(original)need(stable(host.resources[original.id])===stable(original),'RESOURCE_UNAVAILABLE','所选原件尚未完整核验，未接收能力。',409);
      const origin={kind:'shared',...(s.origin?.url?{url:s.origin.url}:{}),...(s.origin?.fileName?{fileName:s.origin.fileName}:{}),...(s.origin?.locator?{locator:structuredClone(s.origin.locator)}:{}),packet:{resourceId:op.packetResourceId,source:structuredClone(s.ref),...(s.author?{sourceAuthor:s.author}:{})}};
      const value={text:s.excerpt,resourceId:original?.id||null,origin,...(s.ink?{ink:structuredClone(s.ink)}:{})},kind=s.ref.kind==='material'?s.kind:s.ink?'ink':'dialogue';
      if(host.materials[id])need(stable(host.materials[id].versions[1])===stable(value),'PACKET_CONTENT_CONFLICT','共享来源身份冲突，未覆盖。',409);else add(host,'materials',id,versioned(id,kind,s.title,value,{status:'current'}));
      return {kind:'material',id,version:1};
    });
    const value={...structuredClone(op.manifest.capability.value),refs};if(target&&op.retainOmitted)for(const field of op.manifest.capability.omittedFields)value[field]=target.versions[String(target.version)][field]||'';const entry=target||versioned(op.id,'capability',value.title,value,{status:'received',publishedVersions:[],changes:[]});
    if(target){target.version++;target.title=value.title;target.versions[String(target.version)]=value;target.status='draft';}else add(host,'capabilities',op.id,entry);
    entry.changes.push({version:entry.version,reason:op.reason,transfer:event(op.manifest,op.packetResourceId,'incoming')});
  }
  return {validate,validManifest,prepare,change,received,applyExport,applyReceive};
}
