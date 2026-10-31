// Trace content schema 2. Browser-safe rules, shared by IDB and SQLite.
// Files and canvas placement have separate owners; neither is a second body.
export class WorkbenchError extends Error {
  constructor(code, message, status = 422) { super(message); this.code = code; this.status = status; }
}
export const demandWorkbench = (condition, code, message, status) => { if (!condition) throw new WorkbenchError(code, message, status); };
const need = demandWorkbench;
export const plainObject = x => x !== null && typeof x === 'object' && !Array.isArray(x);
export const stableWorkbenchJson = x => Array.isArray(x) ? `[${x.map(stableWorkbenchJson).join(',')}]` : plainObject(x) ? `{${Object.keys(x).sort().map(k => `${JSON.stringify(k)}:${stableWorkbenchJson(x[k])}`).join(',')}}` : JSON.stringify(x);
const identity = x => typeof x === 'string' && x.length > 0 && x.length <= 512 && !/[\x00-\x1f\x7f]/.test(x) && !['__proto__','constructor','prototype'].includes(x);
const text = x => typeof x === 'string' && x.length <= 1_000_000;
const integer = x => Number.isSafeInteger(x) && x >= 0;
const finite = x => typeof x === 'number' && Number.isFinite(x);
const optional = check => x => x === undefined || check(x);
const one = (...items) => x => items.includes(x);
const list = (check, limit = 10000) => x => Array.isArray(x) && x.length <= limit && x.every(check);
export const strictObject = (x, fields) => plainObject(x) && Object.keys(x).every(k => Object.hasOwn(fields,k)) && Object.entries(fields).every(([k,check]) => check(x[k]));
const rect = x => strictObject(x,{x:finite,y:finite,width:finite,height:finite}) && x.x >= 0 && x.y >= 0 && x.width > 0 && x.height > 0 && x.x + x.width <= 1.000001 && x.y + x.height <= 1.000001;
const locator = x => plainObject(x) && (
  x.type === 'text' && strictObject(x,{type:one('text'),start:integer,end:integer}) && x.end >= x.start ||
  x.type === 'time' && strictObject(x,{type:one('time'),startMs:integer,endMs:integer}) && x.endMs > x.startMs ||
  x.type === 'pdf' && strictObject(x,{type:one('pdf'),page:n=>integer(n)&&n>=1,rect:optional(rect),rotation:optional(one(0,90,180,270))}) ||
  x.type === 'image' && strictObject(x,{type:one('image'),rect})
);
const url = x => { try { return typeof x === 'string' && ['http:','https:'].includes(new URL(x).protocol); } catch { return false; } };
const origin = x => strictObject(x,{kind:one('manual','local','web','legacy'),url:optional(url),fileName:optional(text),legacyId:optional(identity),locator:optional(locator)});
export const validContentRef = x => strictObject(x,{kind:one('material','expression','capability'),id:identity,version:integer,anchor:optional(locator)});
export const validCanvasContentRef = x => strictObject(x,{kind:one('material','expression','capability'),id:identity,version:v=>v===null||integer(v),anchor:optional(locator)}) && !(x.version===null&&x.anchor);
export function freezeCanvasContentRef(host,ref){need(validCanvasContentRef(ref),'INVALID_REFERENCE','画布引用不正确。');const key={material:'materials',expression:'expressions',capability:'capabilities'}[ref.kind],item=host[key]?.[ref.id];need(item,'REFERENCE_UNAVAILABLE','画布内容不可用。',409);return {...structuredClone(ref),version:ref.version===null?item.version:ref.version};}
const refs = list(validContentRef,256);
const resource = x => strictObject(x,{id:identity,sha256:x=>typeof x==='string'&&/^[a-f0-9]{64}$/.test(x),mime:x=>typeof x==='string'&&/^[\w.+-]+\/[\w.+-]+$/.test(x),bytes:integer}) && x.id === x.sha256;
export const validResourceDescriptor=resource;
const ink = x => strictObject(x,{points:list(p=>strictObject(p,{x:finite,y:finite}),20000),width:n=>finite(n)&&n>0&&n<=64,color:x=>typeof x==='string'&&/^#[a-fA-F0-9]{6}$/.test(x)}) && x.points.length>=2;
const materialValue = x => strictObject(x,{text,resourceId:x=>x===null||identity(x),origin});
const expressionValue = x => strictObject(x,{text,refs,ink:optional(ink)});
const capabilityValue = x => strictObject(x,{title:text,purpose:text,scope:text,steps:text,evidence:text,examples:text,refs});
const catalogs = ['resources','materials','expressions','relations','capabilities','sessions','tasks'];
const operations = {
  'workspace.upgrade': {},
  'workbench.preferences': {displayName:x=>text(x)&&x.length<=200,reduceMotion:x=>typeof x==='boolean'},
  'resource.register': {resource},
  'material.create': {id:identity,kind:one('text','dialogue','code','image','audio','video','web','pdf','ink'),title:text,value:materialValue},
  'expression.create': {id:identity,kind:one('note','annotation','question','understanding','ink'),title:text,value:expressionValue,author:one('user','agent')},
  'expression.edit': {id:identity,expectedVersion:integer,title:text,value:expressionValue},
  'expression.decide': {id:identity,expectedVersion:integer,decision:one('accepted','saved','rejected')},
  'relation.create': {id:identity,from:validContentRef,to:validContentRef,reason:text,evidence:text,difference:text,uncertainty:text,kind:one('supplement','support','limit','challenge','alternative','branch','unknown'),author:one('user','agent')},
  'relation.decide': {id:identity,expectedVersion:integer,decision:one('accepted','saved','rejected','detached'),reason:optional(text)},
  'capability.create': {id:identity,value:capabilityValue},
  'capability.edit': {id:identity,expectedVersion:integer,value:capabilityValue,reason:text},
  'capability.state': {id:identity,expectedVersion:integer,state:one('trial','published','disabled','restored'),reason:text},
  'thinking.create': {id:identity,title:text,refs,excluded:refs},
  'thinking.message': {id:identity,messageId:identity,text,author:one('user')},
  'task.prepare': {id:identity,title:text,goal:text,refs,excluded:refs,destination:text},
  'task.cancel': {id:identity},
};
export const isWorkbenchOperation = x => plainObject(x) && Object.hasOwn(operations,x.type);
export function validateWorkbenchOperation(op) {
  need(isWorkbenchOperation(op) && strictObject(op,{type:identity,...operations[op.type]}),'INVALID_WORKBENCH_COMMAND','不支持的内容动作、字段或字段值。',400);
  return op;
}
function tree(value) {
  const stack=[[value,0]];let count=0;
  while(stack.length){const [x,depth]=stack.pop();need(++count<=250000&&depth<=48,'CONTENT_TOO_COMPLEX','内容结构过大。');if(typeof x==='number')need(finite(x),'INVALID_CONTENT','数字必须有限。');if(x&&typeof x==='object')for(const [key,v]of Object.entries(x)){need(!['__proto__','constructor','prototype'].includes(key),'INVALID_CONTENT','内容包含不支持的对象键。');stack.push([v,depth+1]);}}
}
export function emptyWorkbench() { return {schemaVersion:2,resources:{},materials:{},expressions:{},relations:{},capabilities:{},sessions:{},tasks:{},legacy:null,migration:{version:1,matterRefs:{},sourceRefs:{}}}; }
const current = entity => entity.versions[String(entity.version)];
function versioned(id,kind,title,value,extra={}) {return {id,kind,title,version:1,versions:{'1':structuredClone(value)},...extra};}
function assertVersion(item,version) {need(item,'CONTENT_NOT_FOUND','没有找到这个对象。',404);need(item.version===version,'CONTENT_CONFLICT','对象已更新；保留草稿后重新比较。',409);}
function add(host,collection,id,item) {need(!Object.hasOwn(host[collection],id),'DUPLICATE_CONTENT','对象身份已经存在，未覆盖。',409);host[collection][id]=item;}
export function resolveContentRef(host,ref,{forUse=false}={}) {
  need(validContentRef(ref),'INVALID_REFERENCE','内容引用不完整。');
  const collection={material:'materials',expression:'expressions',capability:'capabilities'}[ref.kind], item=host[collection]?.[ref.id];
  need(item&&Object.hasOwn(item.versions,String(ref.version)),'REFERENCE_UNAVAILABLE','引用的对象或准确版本不可用。',409);
  if(forUse)need(item.status!=='disabled'&&item.status!=='rejected'&&item.status!=='detached','REFERENCE_INACTIVE','内容已停用、拒绝或解除，不能作为本次有效参考。',409);
  const value=item.versions[String(ref.version)];
  if(ref.anchor?.type==='text') {
    const s=value.text||''; const a=ref.anchor;
    need(a.end<=s.length,'ANCHOR_STALE','选段超出这个版本。',409);
    const splits=n=>n>0&&n<s.length&&/[\uD800-\uDBFF]/.test(s[n-1])&&/[\uDC00-\uDFFF]/.test(s[n]);
    need(!splits(a.start)&&!splits(a.end),'INVALID_ANCHOR','选段不能切断完整字符。');
  }
  return {item,value};
}
function checkRefs(host,items,forUse=false){for(const ref of items)resolveContentRef(host,ref,{forUse});}
export function migrateWorkbench(previous) {
  if(previous?.schemaVersion===2)return validateWorkbench(structuredClone(previous));
  const host=emptyWorkbench();if(!previous)return host;
  tree(previous);
  need(previous.schemaVersion===1&&Array.isArray(previous.chain?.matters)&&Array.isArray(previous.chain?.sources),'MIGRATION_UNSUPPORTED','旧工作区格式不正确，未替换原数据。');
  need(previous.chain.matters.every(x=>identity(x.id))&&previous.chain.sources.every(x=>identity(x.id)),'MIGRATION_UNSUPPORTED','旧对象身份无效，未修改。');
  host.legacy=structuredClone(previous);host.preferences=structuredClone(previous.preferences||{displayName:'',reduceMotion:false});delete host.legacy.preferences;
  previous.chain.sources.forEach((source,index)=>{
    const id=`legacy-source-${index}`, value={text:String(source.excerpt||''),resourceId:null,origin:{kind:'legacy',legacyId:source.id,...(url(source.url)?{url:source.url}:{})}};
    host.materials[id]=versioned(id,'text',String(source.title||'原材料'),value,{status:'current'});host.migration.sourceRefs[source.id]={kind:'material',id,version:1};
    delete host.legacy.chain.sources[index].excerpt;
  });
  previous.chain.matters.forEach((matter,index)=>{
    const originalId=`legacy-original-${index}`, understandingId=`legacy-understanding-${index}`;
    host.expressions[originalId]=versioned(originalId,'note',String(matter.title||'原话'),{text:matter.originalText||'',refs:[]},{author:'user',status:'current'});
    const version=matter.understandingVersion||0;
    host.expressions[understandingId]={id:understandingId,kind:'understanding',title:'当前理解',version,versions:{[String(version)]:{text:matter.understanding||'',refs:[]}},author:'user',status:'current'};
    host.migration.matterRefs[matter.id]={original:{kind:'expression',id:originalId,version:1},understanding:{kind:'expression',id:understandingId,version},legacyId:matter.id};
    delete host.legacy.chain.matters[index].originalText;delete host.legacy.chain.matters[index].understanding;
  });
  return validateWorkbench(host);
}
export function projectLegacyWorkbench(host) {
  if(host.schemaVersion!==2)return structuredClone(host);
  if(!host.legacy)return null;
  const old=structuredClone(host.legacy);old.preferences=structuredClone(host.preferences||{displayName:'',reduceMotion:false});
  for(const matter of old.chain.matters){const map=host.migration.matterRefs[matter.id];matter.originalText=resolveContentRef(host,map.original).value.text;const expression=host.expressions[map.understanding.id];matter.understanding=current(expression).text;matter.understandingVersion=expression.version;}
  for(const source of old.chain.sources)source.excerpt=resolveContentRef(host,host.migration.sourceRefs[source.id]).value.text;
  return old;
}
export function validateWorkbench(host) {
  tree(host);need(plainObject(host)&&host.schemaVersion===2,'INVALID_CONTENT','需要内容schema 2。');
  need(Object.keys(host).every(k=>['schemaVersion',...catalogs,'legacy','migration','preferences'].includes(k)),'INVALID_CONTENT','内容存在未支持的顶层字段。');
  for(const catalog of catalogs)need(plainObject(host[catalog])&&Object.keys(host[catalog]).every(identity),'INVALID_CONTENT','内容目录无效。');
  for(const [id,r]of Object.entries(host.resources))need(resource(r)&&r.id===id,'INVALID_RESOURCE','原件元信息不正确。');
  for(const [name,validate]of [['materials',materialValue],['expressions',expressionValue],['capabilities',capabilityValue]])for(const [id,item]of Object.entries(host[name])){
    const fields=['id','kind','title','version','versions','status',...(name==='expressions'?['author']:[]),...(name==='capabilities'?['publishedVersions','changes']:[])];
    need(plainObject(item)&&Object.keys(item).every(key=>fields.includes(key)),'INVALID_CONTENT','内容包含未知字段。');
    need(item.id===id&&integer(item.version)&&text(item.title)&&plainObject(item.versions)&&Object.hasOwn(item.versions,String(item.version)),'INVALID_CONTENT','内容身份或版本不正确。');
    need(name==='materials'?one('text','dialogue','code','image','audio','video','web','pdf','ink')(item.kind)&&item.status==='current':name==='expressions'?one('note','annotation','question','understanding','ink')(item.kind)&&one('user','agent')(item.author)&&one('current','pending','accepted','saved','rejected')(item.status):item.kind==='capability'&&one('draft','trial','published','disabled')(item.status)&&Array.isArray(item.publishedVersions)&&item.publishedVersions.every(integer)&&Array.isArray(item.changes),'INVALID_CONTENT','内容类型或状态无效。');
    for(const [v,value]of Object.entries(item.versions)){need(/^(0|[1-9]\d*)$/.test(v)&&validate(value),'INVALID_CONTENT','内容版本无效。');if(value.resourceId)need(Object.hasOwn(host.resources,value.resourceId),'RESOURCE_UNAVAILABLE','原件引用尚未保存。');if(value.refs)checkRefs(host,value.refs);}
  }
  for(const [id,relation]of Object.entries(host.relations)){need(strictObject(relation,{id:identity,from:validContentRef,to:validContentRef,reason:text,evidence:text,difference:text,uncertainty:text,kind:one('supplement','support','limit','challenge','alternative','branch','unknown'),author:one('user','agent'),version:integer,status:one('pending','accepted','saved','rejected','detached')})&&relation.id===id,'INVALID_RELATION','关系结构不正确。');resolveContentRef(host,relation.from);resolveContentRef(host,relation.to);}
  for(const [id,s]of Object.entries(host.sessions)){need(strictObject(s,{id:identity,title:text,refs,excluded:refs,messages:list(m=>strictObject(m,{id:identity,text,author:one('user')})),status:one('manual')})&&s.id===id&&new Set(s.messages.map(m=>m.id)).size===s.messages.length,'INVALID_SESSION','讨论结构不正确。');checkRefs(host,s.refs);checkRefs(host,s.excluded);}
  for(const [id,t]of Object.entries(host.tasks)){need(strictObject(t,{id:identity,title:text,goal:text,refs,excluded:refs,destination:text,status:one('prepared','cancelled'),results:x=>Array.isArray(x)&&x.length===0})&&t.id===id,'INVALID_TASK','任务结构不正确；未验证执行结果不能写成已返回。');checkRefs(host,t.refs);checkRefs(host,t.excluded);}
  need(strictObject(host.migration,{version:one(1),matterRefs:plainObject,sourceRefs:plainObject}),'INVALID_MIGRATION','迁移映射不完整。');
  if(host.legacy){need(host.legacy.schemaVersion===1&&Array.isArray(host.legacy.chain?.matters)&&Array.isArray(host.legacy.chain?.sources),'INVALID_MIGRATION','旧恢复结构无效。');for(const m of host.legacy.chain.matters){need(!Object.hasOwn(m,'understanding')&&!Object.hasOwn(m,'originalText'),'DUPLICATE_CONTENT_OWNER','旧对象不能另存当前正文。');const map=host.migration.matterRefs[m.id];need(map&&map.legacyId===m.id,'INVALID_MIGRATION','事项迁移映射缺失。');resolveContentRef(host,map.original);need(host.expressions[map.understanding?.id],'INVALID_MIGRATION','理解迁移映射缺失。');}for(const s of host.legacy.chain.sources){need(!Object.hasOwn(s,'excerpt'),'DUPLICATE_CONTENT_OWNER','旧来源不能另存摘录正文。');resolveContentRef(host,host.migration.sourceRefs[s.id]);}}
  need(catalogs.reduce((count,key)=>count+Object.keys(host[key]).length,0)<=10000,'CONTENT_TOO_COMPLEX','内容对象数量超过当前边界。');
  return host;
}
export function applyWorkbenchOperations(previous,ops) {
  need(Array.isArray(ops)&&ops.length>0&&ops.length<=256,'INVALID_WORKBENCH_COMMAND','需要明确的内容动作。',400);ops.forEach(validateWorkbenchOperation);
  let host=previous?.schemaVersion===2?validateWorkbench(structuredClone(previous)):migrateWorkbench(previous);
  for(const op of ops){
    switch(op.type){
      case 'workspace.upgrade':break;
      case 'workbench.preferences':host.preferences={displayName:op.displayName,reduceMotion:op.reduceMotion};break;
      case 'resource.register': {const old=host.resources[op.resource.id];need(!old||stableWorkbenchJson(old)===stableWorkbenchJson(op.resource),'RESOURCE_CONFLICT','同一原件身份不能对应不同内容。',409);host.resources[op.resource.id]=structuredClone(op.resource);break;}
      case 'material.create': if(op.value.resourceId)need(host.resources[op.value.resourceId],'RESOURCE_UNAVAILABLE','请先保存并核验原件。');add(host,'materials',op.id,versioned(op.id,op.kind,op.title,op.value,{status:'current'}));break;
      case 'expression.create':checkRefs(host,op.value.refs);add(host,'expressions',op.id,versioned(op.id,op.kind,op.title,op.value,{author:op.author,status:op.author==='agent'?'pending':'current'}));break;
      case 'expression.edit': {const item=host.expressions[op.id];assertVersion(item,op.expectedVersion);need(item.author==='user','ORIGINAL_PROTECTED','Agent原稿不能被用户编辑覆盖；请另存用户表达。');checkRefs(host,op.value.refs);item.version++;item.title=op.title;item.versions[String(item.version)]=structuredClone(op.value);break;}
      case 'expression.decide': {const item=host.expressions[op.id];assertVersion(item,op.expectedVersion);need(item.author==='agent'&&item.status==='pending','INVALID_TRANSITION','没有待处理的AI建议。');item.status=op.decision;break;}
      case 'relation.create':checkRefs(host,[op.from,op.to]);need(stableWorkbenchJson(op.from)!==stableWorkbenchJson(op.to),'INVALID_RELATION','不能把同一引用连接到自身。');add(host,'relations',op.id,{...structuredClone(op),type:undefined,version:1,status:op.author==='agent'?'pending':'accepted'});delete host.relations[op.id].type;break;
      case 'relation.decide': {const item=host.relations[op.id];assertVersion(item,op.expectedVersion);need(item.status!=='detached','INVALID_TRANSITION','关联已经解除。');if(op.decision==='accepted')checkRefs(host,[item.from,item.to],true);item.status=op.decision;item.version++;if(op.reason!==undefined)item.reason=op.reason;break;}
      case 'capability.create':checkRefs(host,op.value.refs);add(host,'capabilities',op.id,versioned(op.id,'capability',op.value.title,op.value,{status:'draft',publishedVersions:[],changes:[]}));break;
      case 'capability.edit': {const item=host.capabilities[op.id];assertVersion(item,op.expectedVersion);need(item.status!=='disabled','CAPABILITY_DISABLED','先明确恢复后再修订。');checkRefs(host,op.value.refs);item.version++;item.title=op.value.title;item.versions[String(item.version)]=structuredClone(op.value);item.status='draft';item.changes.push({version:item.version,reason:op.reason});break;}
      case 'capability.state': {const item=host.capabilities[op.id];assertVersion(item,op.expectedVersion);if(op.state==='restored'){need(item.status==='disabled','INVALID_TRANSITION','只有停用能力可恢复。');item.status='draft';}else {need(item.status!=='disabled','CAPABILITY_DISABLED','停用能力不能直接启用。');if(op.state==='published'){const value=current(item);need(value.title.trim()&&value.purpose.trim()&&value.scope.trim()&&value.steps.trim(),'CAPABILITY_INCOMPLETE','发布前补齐名称、用途、范围和方法。');if(!item.publishedVersions.includes(item.version))item.publishedVersions.push(item.version);}item.status=op.state;}item.changes.push({version:item.version,state:op.state,reason:op.reason});break;}
      case 'thinking.create':checkRefs(host,op.refs,true);checkRefs(host,op.excluded);need(!op.refs.some(r=>op.excluded.some(e=>stableWorkbenchJson(r)===stableWorkbenchJson(e))),'REFERENCE_CONFLICT','同一引用不能同时包含和排除。');add(host,'sessions',op.id,{id:op.id,title:op.title,refs:structuredClone(op.refs),excluded:structuredClone(op.excluded),messages:[],status:'manual'});break;
      case 'thinking.message': {const s=host.sessions[op.id];need(s,'CONTENT_NOT_FOUND','讨论不存在。',404);need(op.text.trim(),'EMPTY_MESSAGE','请先写下内容。');need(!s.messages.some(m=>m.id===op.messageId),'DUPLICATE_CONTENT','消息身份已存在。',409);s.messages.push({id:op.messageId,text:op.text,author:'user'});break;}
      case 'task.prepare':checkRefs(host,op.refs,true);checkRefs(host,op.excluded);add(host,'tasks',op.id,{id:op.id,title:op.title,goal:op.goal,refs:structuredClone(op.refs),excluded:structuredClone(op.excluded),destination:op.destination,status:'prepared',results:[]});break;
      case 'task.cancel': {const task=host.tasks[op.id];need(task&&task.status==='prepared','INVALID_TRANSITION','只能取消尚未交接的准备。');task.status='cancelled';break;}
    }
  }
  return validateWorkbench(host);
}
