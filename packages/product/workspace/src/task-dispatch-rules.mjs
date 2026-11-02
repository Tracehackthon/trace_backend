// Product owns dispatch permission, not provider progress. Node proofs never
// come from a renderer field; the Agent ledger remains the execution owner.
export function createTaskDispatchRules({need,strictObject,identity,integer,one,optional,list}) {
  const digest=x=>typeof x==='string'&&/^[a-f0-9]{64}$/.test(x);
  const time=x=>typeof x==='string'&&Number.isFinite(Date.parse(x));
  const directory=x=>typeof x==='string'&&x.length>0&&x.length<=4096&&!/[\x00-\x1f\x7f]/.test(x);
  const fields={id:identity,commandId:identity,source:one('native'),requestId:identity,runId:identity,inputVersion:one(1),inputHash:digest,preparedInputHash:digest,projectDir:directory,projectIdentity:directory,mode:one('read-only','workspace-write'),at:time};
  const record=x=>strictObject(x,{...fields,cancelledAt:optional(time)});
  const history=x=>list(record,256)(x)&&new Set(x.map(r=>r.id)).size===x.length;
  const operations={
    'task.dispatch.reserve':{taskId:identity,...fields,previousRunId:x=>x===null||identity(x)},
    'task.dispatch.cancel':{taskId:identity,dispatchId:identity,at:time},
  };
  const state=task=>{const all=[...(task.dispatchHistory||[]),...(task.dispatch?[task.dispatch]:[])];return new Set(all.map(d=>d.id)).size===all.length&&new Set(all.map(d=>d.requestId)).size===all.length&&new Set(all.map(d=>d.runId)).size===all.length&&(!task.dispatchHistory?.length||Boolean(task.dispatch))&&(!task.dispatch||task.preparedInputVersion===1&&Boolean(task.dispatch.cancelledAt)===(task.status==='cancelled'));};
  function apply(host,op,proofs){
    const task=host.tasks[op.taskId],proof=proofs[op.taskId];
    need(task&&task.status==='prepared'&&!task.execution,'TASK_DISPATCH_UNAVAILABLE','任务已取消或绑定其它执行，不会重复派发。',409);
    need(proof?.source==='native-owner'&&proof.allowed===true,'TASK_DISPATCH_UNVERIFIED','派发需要受控本机运行库核验；页面不能自报许可。',409);
    if(op.type==='task.dispatch.cancel'){
      need(task.dispatch?.id===op.dispatchId&&!task.dispatch.cancelledAt&&proof.missingRun===true,'TASK_DISPATCH_CONFLICT','只能明确取消已核验尚未建立运行的原派发。',409);
      task.dispatch.cancelledAt=op.at;task.status='cancelled';return;
    }
    need(proof.inputHash===op.inputHash&&proof.preparedInputHash===op.preparedInputHash,'TASK_INPUT_CHANGED','实际输入与原派发不一致，未创建运行。',409);
    need(!task.dispatch||!task.dispatch.cancelledAt&&task.dispatch.source==='native'&&task.dispatch.runId===op.previousRunId&&proof.previousTerminal===true,'TASK_DISPATCH_CONFLICT','任务已有派发归属，先核对原运行，不会抢占或重复提交。',409);
    need(!task.dispatchHistory?.some(d=>d.id===op.id||d.requestId===op.requestId||d.runId===op.runId)&&task.dispatch?.id!==op.id,'TASK_DISPATCH_CONFLICT','原派发身份应恢复原回执，不能创建第二次派发。',409);
    if(task.dispatch)task.dispatchHistory=[...(task.dispatchHistory||[]),structuredClone(task.dispatch)];
    const {type,taskId,previousRunId,...next}=op;task.preparedInputVersion=1;task.dispatch=structuredClone(next);
  }
  return {record,history,state,operations,apply};
}
