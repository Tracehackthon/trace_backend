// Browser-safe shape rules. Authority is supplied only by the owning Node
// workspace; importing these records never imports an active connection key.
export function createTaskHandoffModel({strictObject,identity,optional,one,list,refs,validContentRef}) {
  const digest=x=>typeof x==='string'&&/^[a-f0-9]{64}$/.test(x);
  const time=x=>typeof x==='string'&&Number.isFinite(Date.parse(x));
  const text=max=>x=>typeof x==='string'&&x.length<=max&&!x.includes('\0');
  const directory=text(4096);
  const request=x=>strictObject(x,{id:identity,commandId:identity,ownerId:identity,sessionId:identity,projectDir:directory,projectIdentity:directory,rootUri:directory,clientName:text(200),at:time,status:one('pending','approved','rejected'),decidedAt:optional(time),decisionCommandId:optional(identity)});
  const artifact=x=>strictObject(x,{title:text(1000),kind:one('file','test','link','note'),path:optional(text(4096)),url:optional(text(4096)),digest:optional(text(512))});
  const payload=x=>strictObject(x,{fact:text(65536),summary:optional(text(65536)),interpretation:optional(text(65536)),unconfirmed:optional(text(65536)),proposedUnderstanding:optional(text(65536)),artifacts:optional(list(artifact,20))})&&x.fact.trim().length>0;
  const review=x=>strictObject(x,{commandId:identity,decision:one('kept','needs_work','rejected'),note:text(16000),at:time});
  const returned=x=>strictObject(x,{id:identity,commandId:identity,deliveryId:identity,contextHash:digest,resultHash:digest,source:validContentRef,payload,at:time,review:optional(review)})&&x.source.kind==='expression'&&x.source.version===1;
  const preparation=x=>strictObject(x,{commandId:identity,ownerId:identity,sessionId:identity,intentId:identity,projectIdentity:directory,inputHash:digest});
  const record=x=>strictObject(x,{preparation:optional(preparation),requests:list(request,32),returns:list(returned,64)})&&new Set(x.requests.map(r=>r.id)).size===x.requests.length&&new Set(x.returns.map(r=>r.id)).size===x.returns.length;
  const externalFields={id:identity,commandId:identity,inputCommandId:identity,source:one('codex'),requestId:identity,deliveryId:identity,ownerId:identity,sessionId:identity,inputVersion:one(1),inputHash:digest,preparedInputHash:digest,projectDir:directory,projectIdentity:directory,rootUri:directory,mode:one('external-host'),at:time};
  const dispatch=x=>strictObject(x,{...externalFields,receivedAt:optional(time),receiveCommandId:optional(identity),revokedAt:optional(time),cancelledAt:optional(time)});
  const state=task=>{
    if(!task.handoff)return task.dispatch?.source!=='codex';
    if(!record(task.handoff))return false;
    const claim=task.dispatch;
    if(claim?.source==='codex'){
      const request=task.handoff.requests.find(r=>r.id===claim.requestId);
      if(!request||request.status!=='approved'||request.ownerId!==claim.ownerId||request.sessionId!==claim.sessionId||request.projectIdentity!==claim.projectIdentity||request.rootUri!==claim.rootUri||Boolean(claim.receivedAt)!==Boolean(claim.receiveCommandId))return false;
    }
    return task.handoff.returns.every(r=>claim?.source==='codex'&&claim.receivedAt&&r.deliveryId===claim.deliveryId&&r.contextHash===claim.inputHash);
  };
  return {record,dispatch,state,payload,artifact};
}
