import {createTaskDispatchRules} from './task-dispatch-rules.mjs';
import {createCapabilityFeedbackRules} from './capability-feedback-rules.mjs';
import {createCapabilityPacketRules} from './capability-packet-rules.mjs';
import {createActivationRules} from './activation-rules.mjs';
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
const origin = x => x?.kind==='thinking-message'
  ? strictObject(x,{kind:one('thinking-message'),message:m=>strictObject(m,{sessionId:identity,messageId:identity}),locator:l=>locator(l)&&l.type==='text'&&l.end>l.start})
  : strictObject(x,{kind:one('manual','local','web','legacy','shared'),url:optional(url),fileName:optional(text),legacyId:optional(identity),locator:optional(locator),packet:optional(x=>strictObject(x,{resourceId:digest,source:validContentRef,sourceAuthor:optional(one('user','agent')),withheld:optional(one('thinking-message'))}))});
export const validContentRef = x => strictObject(x,{kind:one('material','expression','capability'),id:identity,version:integer,anchor:optional(locator)});
export const validCanvasContentRef = x => strictObject(x,{kind:one('material','expression','capability'),id:identity,version:v=>v===null||integer(v),anchor:optional(locator)}) && !(x.version===null&&x.anchor);
export function freezeCanvasContentRef(host,ref){need(validCanvasContentRef(ref),'INVALID_REFERENCE','画布引用不正确。');const key={material:'materials',expression:'expressions',capability:'capabilities'}[ref.kind],item=host[key]?.[ref.id];need(item,'REFERENCE_UNAVAILABLE','画布内容不可用。',409);return {...structuredClone(ref),version:ref.version===null?item.version:ref.version};}
const refs = list(validContentRef,256);
const uniqueReferences = x => refs(x) && new Set(x.map(stableWorkbenchJson)).size === x.length;
export const validMessageScope = x => strictObject(x,{refs:uniqueReferences,excluded:uniqueReferences,historyIds:x=>list(identity,256)(x)&&new Set(x).size===x.length});
// A whole saved object overlaps any of its parts. Mixed anchor types cannot be
// proven disjoint, so exclusions never silently widen a reference.
export function contentReferencesOverlap(a,b) {
  if(a.kind!==b.kind||a.id!==b.id||a.version!==b.version)return false;
  const x=a.anchor,y=b.anchor;if(!x||!y||x.type!==y.type)return true;
  if(x.type==='text')return Math.max(x.start,y.start)<Math.min(x.end,y.end);
  if(x.type==='time')return Math.max(x.startMs,y.startMs)<Math.min(x.endMs,y.endMs);
  if(x.type==='pdf'&&(x.page!==y.page||x.rotation!==y.rotation))return false;
  if(!x.rect||!y.rect)return true;
  return Math.max(x.rect.x,y.rect.x)<Math.min(x.rect.x+x.rect.width,y.rect.x+y.rect.width)-1e-9&&Math.max(x.rect.y,y.rect.y)<Math.min(x.rect.y+x.rect.height,y.rect.y+y.rect.height)-1e-9;
}
export function effectiveContentReferences(included,excluded=[]) {return included.filter(ref=>!excluded.some(other=>contentReferencesOverlap(ref,other)));}
export function validateMessageScope(host,scope,session,before= session.messages.length,{forUse=false}={}) {
  need(validMessageScope(scope),'INVALID_REFERENCE_SCOPE','本次引用范围或历史原话身份不正确。');
  for(const ref of scope.refs)forUse?resolveContentRef(host,ref,{forUse:true}):validateReferenceSelection(host,ref);for(const ref of scope.excluded)validateReferenceSelection(host,ref);
  need(!scope.refs.some(ref=>scope.excluded.some(other=>contentReferencesOverlap(ref,other))),'REFERENCE_CONFLICT','包含与排除的范围相交，请明确缩小或移除其中一项，不会自动裁切。',409);
  const prior=new Set(session.messages.slice(0,before).map(m=>m.id));
  need(scope.historyIds.every(id=>prior.has(id)),'HISTORY_UNAVAILABLE','只可明确引用本讨论中已保存的较早原话，不自动补入其它消息。',409);
  return scope;
}
const resource = x => strictObject(x,{id:identity,sha256:x=>typeof x==='string'&&/^[a-f0-9]{64}$/.test(x),mime:x=>typeof x==='string'&&/^[\w.+-]+\/[\w.+-]+$/.test(x),bytes:integer}) && x.id === x.sha256;
export const validResourceDescriptor=resource;
const ink = x => strictObject(x,{points:list(p=>strictObject(p,{x:finite,y:finite}),20000),width:n=>finite(n)&&n>0&&n<=64,color:x=>typeof x==='string'&&/^#[a-fA-F0-9]{6}$/.test(x)}) && x.points.length>=2;
const materialValue = x => strictObject(x,{text,resourceId:x=>x===null||identity(x),origin,ink:optional(ink)})&&(x.origin.kind!=='thinking-message'||x.resourceId===null&&!x.ink);
const wholeTextBoundary=(text,at)=>Number.isSafeInteger(at)&&at>=0&&at<=text.length&&!(at>0&&at<text.length&&/[\uD800-\uDBFF]/.test(text[at-1])&&/[\uDC00-\uDFFF]/.test(text[at]));
// A capture is an explicitly chosen immutable excerpt. The saved user message
// remains the original; this projection never expands it into Agent context.
export function projectThinkingMessageSource(host,value) {
  if(value?.origin?.kind!=='thinking-message')return {status:'not-applicable'};
  const {message,locator}=value.origin,session=host?.sessions?.[message.sessionId],original=session?.messages.find(m=>m.id===message.messageId);
  if(!original||original.author!=='user')return {status:'unavailable',reason:'原讨论或准确原话暂不可用；摘录仍保留，没有改找同名或相同文字。'};
  if(!wholeTextBoundary(original.text,locator.start)||!wholeTextBoundary(original.text,locator.end)||locator.end<=locator.start||original.text.slice(locator.start,locator.end)!==value.text)return {status:'changed',reason:'原话的记录范围与保存摘录不一致；未重新定位或覆盖摘录。'};
  return {status:'available',text:original.text,locator:structuredClone(locator),sessionId:session.id,messageId:original.id,title:session.title};
}
export function prepareThinkingMessageCapture(host,{id,sessionId,messageId,selection,title}) {
  need(identity(id)&&identity(sessionId)&&identity(messageId)&&text(title)&&title.trim()&&selection?.type==='text'&&locator(selection),'INVALID_MESSAGE_CAPTURE','请明确摘录身份、名称和原话文字范围。');
  const message=host.sessions?.[sessionId]?.messages.find(m=>m.id===messageId);
  need(message?.author==='user','MESSAGE_SOURCE_UNAVAILABLE','准确原话暂不可用，未创建摘录。',409);
  need(wholeTextBoundary(message.text,selection.start)&&wholeTextBoundary(message.text,selection.end)&&selection.end>selection.start,'INVALID_MESSAGE_CAPTURE','摘录范围为空、越界或截断了Unicode字符，未改选其它位置。');
  const value={text:message.text.slice(selection.start,selection.end),resourceId:null,origin:{kind:'thinking-message',message:{sessionId,messageId},locator:structuredClone(selection)}};
  return {operation:{type:'material.create',id,kind:'dialogue',title,value},source:{kind:'material',id,version:1},excerpt:value.text};
}
const expressionValue = x => strictObject(x,{text,refs,ink:optional(ink)});
const expressionKind = one('note','annotation','question','understanding','attempt','ink');
const relationKind = one('supplement','support','limit','challenge','alternative','branch','unknown');
const relationStatus = one('pending','accepted','saved','rejected','detached');
const relationBody = {from:validContentRef,to:validContentRef,reason:text,evidence:text,difference:text,uncertainty:text,kind:relationKind,sources:optional(refs)};
const relationSnapshot = x => strictObject(x,{...relationBody,version:integer,status:relationStatus,modifiedBy:optional(one('user'))});
function rememberRelation(item) {
  const {id,author,history,...previous}=item;
  item.history=[...(history||[]),structuredClone(previous)];
}
const step = x => strictObject(x,{id:identity,text,checked:x=>typeof x==='boolean'});
const stepItems = x => list(step,256)(x) && new Set(x.map(s=>s.id)).size===x.length;
const instructionRefs = x => refs(x) && x.length<=32 && x.every(r=>r.kind==='capability'&&r.version>=1&&!r.anchor) && new Set(x.map(r=>r.id)).size===x.length;
const executionRef=x=>strictObject(x,{source:one('trace-agent-runtime'),runId:x=>typeof x==='string'&&/^[a-zA-Z0-9-]{1,200}$/.test(x),requestId:identity,contextHash:x=>typeof x==='string'&&/^[a-f0-9]{64}$/.test(x)});
const digest=x=>typeof x==='string'&&/^[a-f0-9]{64}$/.test(x);
const adoptedResult=x=>strictObject(x,{source:one('trace-workbench-agent'),runId:identity,inputHash:digest,resultHash:digest,ref:validContentRef,mode:one('new-expression','append-expression','append-capability'),adoptedAt:x=>typeof x==='string'&&Number.isFinite(Date.parse(x))});
const capabilityValue = x => strictObject(x,{title:text,purpose:text,scope:text,steps:text,evidence:text,examples:text,refs,usage:optional(one('method','template','instruction')),prompt:optional(text),stepItems:optional(stepItems)}) && (x.stepItems===undefined || x.steps===x.stepItems.map(s=>s.text).join('\n\n'));
const packets=createCapabilityPacketRules({need,strictObject,identity,text,integer,one,list,optional,resource,origin,ink,capabilityValue,validContentRef,stableWorkbenchJson,resolveContentRef,tree});
export const validateCapabilityPacket=packets.validate;
export const prepareCapabilityPacket=packets.prepare;
export const findReceivedCapabilityPacket=packets.received;
const feedbacks=createCapabilityFeedbackRules({need,strictObject,identity,text,integer,one,list,optional,validContentRef,stableWorkbenchJson,resolveContentRef,validateReferenceSelection,contentReferencesOverlap,capabilityValue});
export const validCapabilityFeedbackInput=feedbacks.input;
export const capabilityFeedbackNeedsProof=feedbacks.requiresProof;
export const feedbackContextReferences=feedbacks.sourceRefs;
export const capabilityFeedbackInputContext=feedbacks.inputContext;
const activations=createActivationRules({need,strictObject,identity,integer,one,list,optional,validContentRef,stableWorkbenchJson,resolveContentRef,validateReferenceSelection,contentReferencesOverlap,instructionRefs});
export const activationNeedsProof=activations.needsProof;
export const activationInput=activations.input;
export const activationReferenceText=activations.referenceText;
export const validActivationCandidate=activations.candidate;
export const validActivationExplanation=activations.explanation;
export const verifyActivationLayout=activations.verifyLayout;
export const parseActivationOutput=activations.parseOutput;
const taskDispatch=createTaskDispatchRules({need,strictObject,identity,integer,one,optional,list});
const catalogs = ['resources','materials','expressions','relations','capabilities','sessions','tasks'];
const operations = {
  ...taskDispatch.operations,
  ...activations.operations,
  'workspace.upgrade': {},
  'workbench.preferences': {displayName:x=>text(x)&&x.length<=200,reduceMotion:x=>typeof x==='boolean'},
  'resource.register': {resource},
  'material.create': {id:identity,kind:one('text','dialogue','code','image','audio','video','web','pdf','ink'),title:text,value:materialValue},
  'expression.create': {id:identity,kind:expressionKind,title:text,value:expressionValue,author:one('user','agent')},
  'expression.edit': {id:identity,expectedVersion:integer,title:text,value:expressionValue},
  'expression.decide': {id:identity,expectedVersion:integer,decision:one('accepted','saved','rejected')},
  'relation.create': {id:identity,...relationBody,author:one('user','agent')},
  'relation.edit': {id:identity,expectedVersion:integer,reason:text,evidence:text,difference:text,uncertainty:text,kind:relationKind},
  'relation.decide': {id:identity,expectedVersion:integer,decision:one('accepted','saved','rejected','detached'),reason:optional(text)},
  'capability.create': {id:identity,value:capabilityValue},
  'capability.edit': {id:identity,expectedVersion:integer,value:capabilityValue,reason:text},
  'capability.state': {id:identity,expectedVersion:integer,state:one('trial','published','disabled','restored','adopted'),reason:text},
  'capability.package.export': {id:identity,expectedVersion:integer,packetResourceId:digest,manifest:packets.validManifest},
  'capability.package.receive': {id:identity,expectedVersion:optional(integer),packetResourceId:digest,manifest:packets.validManifest,mode:one('new','update'),retainOmitted:x=>typeof x==='boolean',reason:text},
  'feedback.record':{id:identity,value:feedbacks.input},
  'feedback.edit':{id:identity,expectedVersion:integer,value:feedbacks.input},
  'feedback.state':{id:identity,expectedVersion:integer,state:one('withdrawn','restored'),reason:text,at:x=>typeof x==='string'&&Number.isFinite(Date.parse(x))},
  'feedback.apply':{id:identity,expectedVersion:integer,action:one('keep','revise','disable'),expectedCapabilityVersion:optional(integer),value:optional(capabilityValue),reason:text,at:x=>typeof x==='string'&&Number.isFinite(Date.parse(x))},
  'thinking.create': {id:identity,title:text,refs,excluded:refs},
  'thinking.instructions': {id:identity,instructions:instructionRefs},
  'thinking.message': {id:identity,messageId:identity,text,author:one('user'),template:optional(validContentRef),scope:optional(validMessageScope)},
  'task.prepare': {id:identity,title:text,goal:text,refs,excluded:refs,destination:text,instructions:optional(instructionRefs),plan:optional(stepItems),template:optional(validContentRef)},
  'task.execution': {id:identity,execution:x=>x===null||executionRef(x)},
  'task.result.adopt': {id:identity,result:adoptedResult},
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
export function emptyWorkbench() { return {schemaVersion:2,activations:{},feedbacks:{},resources:{},materials:{},expressions:{},relations:{},capabilities:{},sessions:{},tasks:{},legacy:null,migration:{version:1,matterRefs:{},sourceRefs:{}}}; }
const current = entity => entity.versions[String(entity.version)];
function versioned(id,kind,title,value,extra={}) {return {id,kind,title,version:1,versions:{'1':structuredClone(value)},...extra};}
function assertVersion(item,version) {need(item,'CONTENT_NOT_FOUND','没有找到这个对象。',404);need(item.version===version,'CONTENT_CONFLICT','对象已更新；保留草稿后重新比较。',409);}
function add(host,collection,id,item) {need(!Object.hasOwn(host[collection],id),'DUPLICATE_CONTENT','对象身份已经存在，未覆盖。',409);host[collection][id]=item;}
// New explicit selections narrow a saved object; historical locators stay intact.
function checkReferenceAnchor(item,value,ref) {
  const a=ref.anchor;if(!a)return;
  const base=value.origin?.locator,inside=(r,b={x:0,y:0,width:1,height:1})=>r.x>=b.x-1e-6&&r.y>=b.y-1e-6&&r.x+r.width<=b.x+b.width+1e-6&&r.y+r.height<=b.y+b.height+1e-6;
  if(a.type==='text'){need(typeof value.text==='string'&&a.end>a.start,'INVALID_ANCHOR','请引用该保存版本中非空的完整文字选段。',409);return;}
  if(a.type==='image'){need(item.kind==='image'&&(!base||base.type==='image')&&inside(a.rect,base?.rect),'ANCHOR_OUTSIDE_SOURCE','图片引用不能超出这份材料已保存的范围。',409);return;}
  if(a.type==='time'){need(['audio','video'].includes(item.kind)&&base?.type==='time','ANCHOR_RANGE_UNKNOWN','先保存明确的音视频片段范围，再选择其中局部；不猜原件时长。',409);need(a.startMs>=base.startMs&&a.endMs<=base.endMs,'ANCHOR_OUTSIDE_SOURCE','引用时间不能超出这份材料已保存的片段。',409);return;}
  need(a.type==='pdf'&&item.kind==='pdf'&&base?.type==='pdf','ANCHOR_RANGE_UNKNOWN','先保存明确PDF页/区域，再引用其中局部；不猜页数。',409);
  need(a.page===base.page&&a.rotation===base.rotation&&(!base.rect||a.rect)&&(!a.rect||inside(a.rect,base.rect)),'ANCHOR_OUTSIDE_SOURCE','PDF引用必须保留原页与旋转，区域不能超出已保存局部。',409);
}
export function validateReferenceSelection(host,ref) {const result=resolveContentRef(host,ref);checkReferenceAnchor(result.item,result.value,ref);return result;}
export function resolveContentRef(host,ref,{forUse=false}={}) {
  need(validContentRef(ref),'INVALID_REFERENCE','内容引用不完整。');
  const collection={material:'materials',expression:'expressions',capability:'capabilities'}[ref.kind], item=host[collection]?.[ref.id];
  need(item&&Object.hasOwn(item.versions,String(ref.version)),'REFERENCE_UNAVAILABLE','引用的对象或准确版本不可用。',409);
  if(forUse)need(item.status!=='disabled'&&item.status!=='received'&&item.status!=='rejected'&&item.status!=='detached','REFERENCE_INACTIVE','内容已停用、拒绝或解除，不能作为本次有效参考。',409);
  const value=item.versions[String(ref.version)];
  if(ref.anchor?.type==='text') {
    const s=value.text||''; const a=ref.anchor;
    need(a.end<=s.length,'ANCHOR_STALE','选段超出这个版本。',409);
    const splits=n=>n>0&&n<s.length&&/[\uD800-\uDBFF]/.test(s[n-1])&&/[\uDC00-\uDFFF]/.test(s[n]);
    need(!splits(a.start)&&!splits(a.end),'INVALID_ANCHOR','选段不能切断完整字符。');
  }
  if(forUse)checkReferenceAnchor(item,value,ref);
  return {item,value};
}
function checkRefs(host,items,forUse=false){for(const ref of items)resolveContentRef(host,ref,{forUse});}
function checkInstructions(host,items,forUse=false){for(const ref of items){const {value}=resolveContentRef(host,ref,{forUse});need(ref.kind==='capability'&&value.usage==='instruction'&&value.prompt?.trim(),'INVALID_INSTRUCTION','指令需引用有正文的准确能力库指令版本。');}}
function checkTemplate(host,ref,forUse=false){const {value}=resolveContentRef(host,ref,{forUse});need(ref.kind==='capability'&&value.usage!=='instruction','INVALID_TEMPLATE','模板必须来自能力库的方法或模板版本。');}
// Only prepared input belongs in a task context. Dispatch receipts and adopted
// results must not change its hash or enter the next model call implicitly.
export function taskInput(host,id,{forUse=true}={}) {
  const task=host?.tasks?.[id];need(task&&task.status==='prepared'&&task.goal.trim()&&!task.execution,'TASK_UNAVAILABLE','任务已取消或绑定其它执行；未扩大范围或重复提交。',409);
  validateMessageScope(host,{refs:task.refs,excluded:task.excluded,historyIds:[]},{messages:[]},0,{forUse});
  checkInstructions(host,effectiveContentReferences(task.instructions||[],task.excluded),forUse);
  const fragments=[];
  for(const [role,items]of [['reference',task.refs],['instruction',task.instructions||[]]])for(const ref of effectiveContentReferences(items,task.excluded)){
    const {item,value}=resolveContentRef(host,ref,{forUse});let text=role==='instruction'?value.prompt:ref.kind==='capability'?JSON.stringify(value):value.text;
    need(!ref.anchor||ref.anchor.type==='text','TASK_MEDIA_NOT_READABLE','当前文本执行器不能读取该媒体局部；未扩大成整份材料，请先明确摘取文字。',409);
    if(ref.anchor?.type==='text')text=text.slice(ref.anchor.start,ref.anchor.end);
    need(typeof text==='string'&&text.trim(),'TASK_FRAGMENT_UNAVAILABLE','所选材料没有文字摘录；未自动上传原件。',409);
    fragments.push({id:`${role}:${fragments.length+1}`,role,revision:ref.version,text,title:item.title,ref:structuredClone(ref)});
  }
  const inputFields=new Set(['id','title','goal','refs','excluded','destination','instructions','plan','template','status','results']);
  const body=Object.fromEntries(Object.entries(structuredClone(task)).filter(([key])=>inputFields.has(key)));body.results=[];
  const input={task:body,fragments};need(new TextEncoder().encode(JSON.stringify(input)).length<=256*1024,'TASK_INPUT_TOO_LARGE','本次任务超过256 KiB，请缩小明确引用的范围。',413);return input;
}
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
  need(Object.keys(host).every(k=>['schemaVersion',...catalogs,'feedbacks','activations','legacy','migration','preferences'].includes(k)),'INVALID_CONTENT','内容存在未支持的顶层字段。');
  for(const catalog of catalogs)need(plainObject(host[catalog])&&Object.keys(host[catalog]).every(identity),'INVALID_CONTENT','内容目录无效。');
  if(host.feedbacks!==undefined)need(plainObject(host.feedbacks)&&Object.keys(host.feedbacks).every(identity),'INVALID_FEEDBACK','反馈目录格式无效。');
  for(const [id,r]of Object.entries(host.resources))need(resource(r)&&r.id===id,'INVALID_RESOURCE','原件元信息不正确。');
  for(const [name,validate]of [['materials',materialValue],['expressions',expressionValue],['capabilities',capabilityValue]])for(const [id,item]of Object.entries(host[name])){
    const fields=['id','kind','title','version','versions','status',...(name==='expressions'?['author']:[]),...(name==='capabilities'?['publishedVersions','changes']:[])];
    need(plainObject(item)&&Object.keys(item).every(key=>fields.includes(key)),'INVALID_CONTENT','内容包含未知字段。');
    need(item.id===id&&integer(item.version)&&text(item.title)&&plainObject(item.versions)&&Object.hasOwn(item.versions,String(item.version)),'INVALID_CONTENT','内容身份或版本不正确。');
    need(name==='materials'?one('text','dialogue','code','image','audio','video','web','pdf','ink')(item.kind)&&item.status==='current':name==='expressions'?expressionKind(item.kind)&&one('user','agent')(item.author)&&one('current','pending','accepted','saved','rejected')(item.status):item.kind==='capability'&&one('draft','trial','published','disabled','received')(item.status)&&Array.isArray(item.publishedVersions)&&item.publishedVersions.every(integer)&&Array.isArray(item.changes)&&item.changes.every(c=>packets.change(c)||feedbacks.change(c)),'INVALID_CONTENT','内容类型或状态无效。');
    for(const [v,value]of Object.entries(item.versions)){need(/^(0|[1-9]\d*)$/.test(v)&&validate(value),'INVALID_CONTENT','内容版本无效。');if(value.resourceId)need(Object.hasOwn(host.resources,value.resourceId),'RESOURCE_UNAVAILABLE','原件引用尚未保存。');if(value.refs)checkRefs(host,value.refs);if(value.origin?.packet)need(host.resources[value.origin.packet.resourceId],'RESOURCE_UNAVAILABLE','共享来源的版本包原件未登记。');}
  }
  for(const capability of Object.values(host.capabilities))for(const c of capability.changes)if(c.transfer)need(host.resources[c.transfer.packetResourceId]&&c.version<=capability.version,'INVALID_CONTENT','版本交接记录缺少原件或准确本地版本。');
  for(const [id,relation]of Object.entries(host.relations)){
    need(strictObject(relation,{id:identity,...relationBody,author:one('user','agent'),version:integer,status:relationStatus,modifiedBy:optional(one('user')),history:optional(list(relationSnapshot))})&&relation.id===id,'INVALID_RELATION','关系结构不正确。');
    let previous=-1;
    for(const value of [...(relation.history||[]),relation]){need(value.version>previous&&value.version<=relation.version,'INVALID_RELATION','关系历史版本次序不正确。');previous=value.version;checkRefs(host,[value.from,value.to,...(value.sources||[])]);}
  }
  for(const [id,s]of Object.entries(host.sessions)){need(strictObject(s,{id:identity,title:text,refs,excluded:refs,instructions:optional(instructionRefs),messages:list(m=>strictObject(m,{id:identity,text,author:one('user'),instructions:optional(instructionRefs),template:optional(validContentRef),scope:optional(validMessageScope)})),status:one('manual')})&&s.id===id&&new Set(s.messages.map(m=>m.id)).size===s.messages.length,'INVALID_SESSION','讨论结构不正确。');checkRefs(host,s.refs);checkRefs(host,s.excluded);checkInstructions(host,s.instructions||[]);for(const [index,m]of s.messages.entries()){if(m.scope)validateMessageScope(host,m.scope,s,index);checkInstructions(host,m.instructions||[]);if(m.template)checkTemplate(host,m.template);}}
  for(const [id,t]of Object.entries(host.tasks)){need(strictObject(t,{id:identity,title:text,goal:text,refs,excluded:refs,destination:text,instructions:optional(instructionRefs),plan:optional(stepItems),template:optional(validContentRef),execution:optional(executionRef),status:one('prepared','cancelled'),preparedInputVersion:optional(one(1)),dispatch:optional(taskDispatch.record),dispatchHistory:optional(taskDispatch.history),results:x=>list(adoptedResult,256)(x)&&new Set(x.map(r=>r.runId)).size===x.length})&&t.id===id&&taskDispatch.state(t),'INVALID_TASK','任务结构不正确；未验证执行结果不能写成已返回。');checkRefs(host,t.refs);checkRefs(host,t.excluded);checkRefs(host,t.results.map(r=>r.ref));checkInstructions(host,t.instructions||[]);if(t.template)checkTemplate(host,t.template);}
  need(strictObject(host.migration,{version:one(1),matterRefs:plainObject,sourceRefs:plainObject}),'INVALID_MIGRATION','迁移映射不完整。');
  if(host.legacy){need(host.legacy.schemaVersion===1&&Array.isArray(host.legacy.chain?.matters)&&Array.isArray(host.legacy.chain?.sources),'INVALID_MIGRATION','旧恢复结构无效。');for(const m of host.legacy.chain.matters){need(!Object.hasOwn(m,'understanding')&&!Object.hasOwn(m,'originalText'),'DUPLICATE_CONTENT_OWNER','旧对象不能另存当前正文。');const map=host.migration.matterRefs[m.id];need(map&&map.legacyId===m.id,'INVALID_MIGRATION','事项迁移映射缺失。');resolveContentRef(host,map.original);need(host.expressions[map.understanding?.id],'INVALID_MIGRATION','理解迁移映射缺失。');}for(const s of host.legacy.chain.sources){need(!Object.hasOwn(s,'excerpt'),'DUPLICATE_CONTENT_OWNER','旧来源不能另存摘录正文。');resolveContentRef(host,host.migration.sourceRefs[s.id]);}}
  feedbacks.validate(host);
  activations.validate(host);
  need(catalogs.reduce((count,key)=>count+Object.keys(host[key]).length,0)+Object.keys(host.feedbacks||{}).length+Object.keys(host.activations||{}).length<=10000,'CONTENT_TOO_COMPLEX','内容对象数量超过当前边界。');
  return host;
}
export function applyWorkbenchOperations(previous,ops,{feedbackEvidence={},activationEvidence={},activationPlacements={},taskDispatchEvidence={}}={}) {
  need(Array.isArray(ops)&&ops.length>0&&ops.length<=256,'INVALID_WORKBENCH_COMMAND','需要明确的内容动作。',400);ops.forEach(validateWorkbenchOperation);
  let host=previous?.schemaVersion===2?validateWorkbench(structuredClone(previous)):migrateWorkbench(previous);
  host.feedbacks??={};
  for(const op of ops){
    if(Object.hasOwn(taskDispatch.operations,op.type)){taskDispatch.apply(host,op,taskDispatchEvidence);continue;}
    if(Object.hasOwn(activations.operations,op.type)){activations.apply(host,op,{add,assertVersion,proofs:activationEvidence,placements:activationPlacements});continue;}
    switch(op.type){
      case 'workspace.upgrade':break;
      case 'workbench.preferences':host.preferences={displayName:op.displayName,reduceMotion:op.reduceMotion};break;
      case 'resource.register': {const old=host.resources[op.resource.id];need(!old||stableWorkbenchJson(old)===stableWorkbenchJson(op.resource),'RESOURCE_CONFLICT','同一原件身份不能对应不同内容。',409);host.resources[op.resource.id]=structuredClone(op.resource);break;}
      case 'material.create': if(op.value.resourceId)need(host.resources[op.value.resourceId],'RESOURCE_UNAVAILABLE','请先保存并核验原件。');if(op.value.origin.kind==='thinking-message')need(op.kind==='dialogue'&&projectThinkingMessageSource(host,op.value).status==='available','MESSAGE_SOURCE_MISMATCH','准确原话或选段与保存摘录不一致；没有写入、猜选来源或扩大范围。',409);add(host,'materials',op.id,versioned(op.id,op.kind,op.title,op.value,{status:'current'}));break;
      case 'expression.create':checkRefs(host,op.value.refs);add(host,'expressions',op.id,versioned(op.id,op.kind,op.title,op.value,{author:op.author,status:op.author==='agent'?'pending':'current'}));break;
      case 'expression.edit': {const item=host.expressions[op.id];assertVersion(item,op.expectedVersion);need(item.author==='user','ORIGINAL_PROTECTED','Agent原稿不能被用户编辑覆盖；请另存用户表达。');checkRefs(host,op.value.refs);item.version++;item.title=op.title;item.versions[String(item.version)]=structuredClone(op.value);break;}
      case 'expression.decide': {const item=host.expressions[op.id];assertVersion(item,op.expectedVersion);need(item.author==='agent'&&item.status==='pending','INVALID_TRANSITION','没有待处理的AI建议。');item.status=op.decision;break;}
      case 'relation.create':checkRefs(host,[op.from,op.to],op.author==='user');checkRefs(host,op.sources||[]);need(stableWorkbenchJson(op.from)!==stableWorkbenchJson(op.to),'INVALID_RELATION','不能把同一引用连接到自身。');add(host,'relations',op.id,{...structuredClone(op),type:undefined,version:1,status:op.author==='agent'?'pending':'accepted'});delete host.relations[op.id].type;break;
      case 'relation.edit': {const item=host.relations[op.id];assertVersion(item,op.expectedVersion);need(item.status!=='detached','INVALID_TRANSITION','关联已经解除；请明确另建关系。');if(item.status==='accepted')checkRefs(host,[item.from,item.to],true);rememberRelation(item);item.modifiedBy='user';for(const key of ['reason','evidence','difference','uncertainty','kind'])item[key]=op[key];item.version++;break;}
      case 'relation.decide': {const item=host.relations[op.id];assertVersion(item,op.expectedVersion);need(item.status!=='detached','INVALID_TRANSITION','关联已经解除。');if(op.decision==='accepted')checkRefs(host,[item.from,item.to],true);rememberRelation(item);item.status=op.decision;item.version++;if(op.reason!==undefined)item.reason=op.reason;break;}
      case 'capability.create':checkRefs(host,op.value.refs);add(host,'capabilities',op.id,versioned(op.id,'capability',op.value.title,op.value,{status:'draft',publishedVersions:[],changes:[]}));break;
      case 'capability.edit': {const item=host.capabilities[op.id];assertVersion(item,op.expectedVersion);need(item.status!=='disabled'&&item.status!=='received','CAPABILITY_DISABLED','先明确采用或恢复后再修订。');checkRefs(host,op.value.refs);item.version++;item.title=op.value.title;item.versions[String(item.version)]=structuredClone(op.value);item.status='draft';item.changes.push({version:item.version,reason:op.reason});break;}
      case 'capability.state': {const item=host.capabilities[op.id];assertVersion(item,op.expectedVersion);if(op.state==='adopted'){need(item.status==='received','INVALID_TRANSITION','只有未采用的接收能力需要明确采用。');item.status='draft';}else if(op.state==='restored'){need(item.status==='disabled','INVALID_TRANSITION','只有停用能力可恢复。');item.status='draft';}else {need(item.status!=='disabled'&&item.status!=='received','CAPABILITY_DISABLED','先明确采用或恢复，不自动启用。');if(op.state==='published'){const value=current(item);need(value.title.trim()&&value.purpose.trim()&&value.scope.trim()&&value.steps.trim(),'CAPABILITY_INCOMPLETE','发布前补齐名称、用途、范围和方法。');if(!item.publishedVersions.includes(item.version))item.publishedVersions.push(item.version);}item.status=op.state;}item.changes.push({version:item.version,state:op.state,reason:op.reason});break;}
      case 'capability.package.export':packets.applyExport(host,op);break;
      case 'capability.package.receive':packets.applyReceive(host,op,{versioned,add,assertVersion});break;
      case 'feedback.record':case 'feedback.edit':case 'feedback.state':case 'feedback.apply':feedbacks.apply(host,op,{versioned,add,assertVersion,checkRefs,proofs:feedbackEvidence});break;
      case 'thinking.create':checkRefs(host,op.refs,true);checkRefs(host,op.excluded);need(!op.refs.some(r=>op.excluded.some(e=>stableWorkbenchJson(r)===stableWorkbenchJson(e))),'REFERENCE_CONFLICT','同一引用不能同时包含和排除。');add(host,'sessions',op.id,{id:op.id,title:op.title,refs:structuredClone(op.refs),excluded:structuredClone(op.excluded),messages:[],status:'manual'});break;
      case 'thinking.instructions': {const session=host.sessions[op.id];need(session,'CONTENT_NOT_FOUND','讨论不存在。',404);checkInstructions(host,op.instructions,true);session.instructions=structuredClone(op.instructions);break;}
      case 'thinking.message': {const s=host.sessions[op.id];need(s,'CONTENT_NOT_FOUND','讨论不存在。',404);need(op.text.trim(),'EMPTY_MESSAGE','请先写下内容。');need(!s.messages.some(m=>m.id===op.messageId),'DUPLICATE_CONTENT','消息身份已存在。',409);const scope=structuredClone(op.scope||{refs:s.refs,excluded:s.excluded,historyIds:[]});validateMessageScope(host,scope,s,s.messages.length,{forUse:true});checkInstructions(host,effectiveContentReferences(s.instructions||[],scope.excluded),true);if(op.template)checkTemplate(host,op.template,!scope.excluded.some(e=>contentReferencesOverlap(e,op.template)));s.messages.push({id:op.messageId,text:op.text,author:'user',instructions:structuredClone(s.instructions||[]),scope,...(op.template?{template:structuredClone(op.template)}:{})});break;}
      case 'task.prepare':validateMessageScope(host,{refs:op.refs,excluded:op.excluded,historyIds:[]},{messages:[]},0,{forUse:true});checkInstructions(host,effectiveContentReferences(op.instructions||[],op.excluded),true);if(op.template)checkTemplate(host,op.template,!op.excluded.some(e=>contentReferencesOverlap(e,op.template)));add(host,'tasks',op.id,{id:op.id,title:op.title,goal:op.goal,refs:structuredClone(op.refs),excluded:structuredClone(op.excluded),destination:op.destination,status:'prepared',preparedInputVersion:1,results:[],...(op.instructions?{instructions:structuredClone(op.instructions)}:{}),...(op.plan?{plan:structuredClone(op.plan)}:{}),...(op.template?{template:structuredClone(op.template)}:{})});break;
      case 'task.execution': {const task=host.tasks[op.id];need(task,'CONTENT_NOT_FOUND','任务不存在。',404);if(op.execution===null)delete task.execution;else{need(!task.dispatch,'TASK_DISPATCH_CONFLICT','任务已有派发归属，未绑定第二个执行。',409);task.execution=structuredClone(op.execution)};break;}
      case 'task.result.adopt': {const task=host.tasks[op.id];need(task&&task.status==='prepared'&&!task.execution,'INVALID_TRANSITION','只有当前原生任务的结果可以明确采用。');need(!task.results.some(r=>r.runId===op.result.runId),'DUPLICATE_RESULT','这次运行已经采用，不重复写回。',409);checkRefs(host,[op.result.ref]);task.results.push(structuredClone(op.result));break;}
      case 'task.cancel': {const task=host.tasks[op.id];need(task&&task.status==='prepared'&&!task.execution&&!task.dispatch,'INVALID_TRANSITION','只能取消尚未派发的准备；已有派发须核对原运行或明确取消未开始的原派发。');task.status='cancelled';break;}
    }
  }
  return validateWorkbench(host);
}
