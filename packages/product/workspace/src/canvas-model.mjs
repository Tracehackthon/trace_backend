// Layout is independently versioned. This module never edits content bodies.
import {demandWorkbench as need,plainObject,strictObject,validCanvasContentRef,stableWorkbenchJson} from './workbench-model.mjs';
const id=x=>typeof x==='string'&&x.length>0&&x.length<=512&&!['__proto__','constructor','prototype'].includes(x)&&!/[\x00-\x1f]/.test(x);
const finite=x=>typeof x==='number'&&Number.isFinite(x)&&Math.abs(x)<=1e8;
const positive=x=>finite(x)&&x>=16&&x<=1e5;
const strings=x=>Array.isArray(x)&&x.length<=10000&&x.every(id)&&new Set(x).size===x.length;
const position=x=>strictObject(x,{x:finite,y:finite});
export const emptyCanvas = (canvasId,title='未命名画布') => ({schemaVersion:1,id:canvasId,title,revision:0,nodes:[],connections:[],undo:[],redo:[]});
export function validateCanvasScene(scene) {
  need(strictObject(scene,{nodes:Array.isArray,connections:Array.isArray})&&scene.nodes.length<=10000&&scene.connections.length<=20000,'INVALID_CANVAS','画布结构或数量不正确。');
  const ids=new Map();
  for(const node of scene.nodes){need(strictObject(node,{id,ref:x=>x===null||validCanvasContentRef(x),position,width:positive,height:positive,groupId:x=>x===null||id(x),label:x=>typeof x==='string'&&x.length<=1000})&&!ids.has(node.id),'INVALID_CANVAS_NODE','节点字段、尺寸或身份不正确。');ids.set(node.id,node);}
  for(const node of scene.nodes){if(node.groupId){need(ids.has(node.groupId)&&ids.get(node.groupId).ref===null,'INVALID_CANVAS_GROUP','空间组不存在。');const visited=new Set([node.id]);let group=node;while(group.groupId){need(!visited.has(group.groupId),'INVALID_CANVAS_GROUP','空间组不能循环。');visited.add(group.groupId);group=ids.get(group.groupId);need(group,'INVALID_CANVAS_GROUP','父空间组不存在。');}}}
  const edges=new Set();for(const edge of scene.connections){need(strictObject(edge,{id,from:id,to:id,relationId:x=>x===null||id(x)})&&!edges.has(edge.id)&&edge.from!==edge.to&&ids.has(edge.from)&&ids.has(edge.to),'INVALID_CANVAS_CONNECTION','连接身份或两端不正确。');edges.add(edge.id);}
  return scene;
}
export function validateCanvasDocument(document) {
  need(strictObject(document,{schemaVersion:x=>x===1,id,title:x=>typeof x==='string'&&x.length<=1000,revision:x=>Number.isSafeInteger(x)&&x>=0,nodes:Array.isArray,connections:Array.isArray,undo:Array.isArray,redo:Array.isArray})&&document.undo.length<=100&&document.redo.length<=100,'CANVAS_CORRUPT','画布文档或历史损坏，未创建替代画布。',503);
  validateCanvasScene({nodes:document.nodes,connections:document.connections});
  for(const scene of [...document.undo,...document.redo])validateCanvasScene(scene);
  return document;
}
export function validateCanvasCommand(command) {
  need(strictObject(command,{protocolVersion:x=>x===1,commandId:id,expectedRevision:x=>Number.isSafeInteger(x)&&x>=0,action:x=>['replace','undo','redo','rename'].includes(x),scene:x=>x===undefined||plainObject(x),title:x=>x===undefined||typeof x==='string'&&x.length<=1000,activation:x=>x===undefined||strictObject(x,{id,candidateId:id})}),'INVALID_CANVAS_COMMAND','画布命令不完整。',400);
  if(command.activation)need(command.action==='replace','INVALID_CANVAS_COMMAND','同框意图只允许明确的布局放置，不改写撤销或命名。',400);
  if(command.action==='replace')validateCanvasScene(command.scene);
  else need(command.scene===undefined,'INVALID_CANVAS_COMMAND','该动作不接受布局快照。',400);
  if(command.action==='rename')need(typeof command.title==='string'&&command.title.trim(),'INVALID_CANVAS_COMMAND','需要画布名称。');else need(command.title===undefined,'INVALID_CANVAS_COMMAND','该动作不接受名称。',400);
  return command;
}
export function applyCanvasCommand(previous,command) {
  validateCanvasDocument(previous);validateCanvasCommand(command);const next=structuredClone(previous);
  need(command.expectedRevision===next.revision,'CANVAS_CONFLICT','画布已在别处更新；当前布局尚未覆盖。',409);
  const current={nodes:next.nodes,connections:next.connections};
  if(command.action==='rename')next.title=command.title.trim();
  else if(command.action==='replace') {next.undo.push(structuredClone(current));next.redo=[];Object.assign(next,structuredClone(command.scene));}
  else {const from=command.action==='undo'?next.undo:next.redo,to=command.action==='undo'?next.redo:next.undo;need(from.length,'CANVAS_HISTORY_EMPTY','没有可以撤销或重做的操作。');to.push(structuredClone(current));Object.assign(next,from.pop());}
  next.undo=next.undo.slice(-100);next.redo=next.redo.slice(-100);next.revision++;
  validateCanvasScene({nodes:next.nodes,connections:next.connections});return next;
}
export function canvasCommandFingerprint(command){return stableWorkbenchJson(command);}
