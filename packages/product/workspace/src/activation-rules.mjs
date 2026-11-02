// Product-owned exploration records. Provider attempts and canvas scenes retain
// their existing owners; these rules never invent either kind of receipt.
export function createActivationRules({need,strictObject:shape,identity,integer,one,list,optional,validContentRef:ref,stableWorkbenchJson:stable,resolveContentRef:resolve,validateReferenceSelection:select,contentReferencesOverlap:overlap,instructionRefs}) {
  const short=x=>typeof x==='string'&&x.length<=4000;
  const nonempty=x=>short(x)&&Boolean(x.trim());
  const stamp=x=>typeof x==='string'&&Number.isFinite(Date.parse(x));
  const digest=x=>typeof x==='string'&&/^[a-f0-9]{64}$/.test(x);
  const unique=x=>list(ref,64)(x)&&new Set(x.map(stable)).size===x.length;
  const canvas=x=>typeof x==='string'&&/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/.test(x);
  const same=(a,b)=>stable(a)===stable(b);
  const includes=(rs,r)=>rs.some(v=>same(v,r));
  const source=x=>shape(x,{kind:one('manual')})||shape(x,{kind:one('native-result'),runId:identity,inputHash:digest,resultHash:digest});
  const evidence=x=>shape(x,{ref,start:integer,end:integer,quote:nonempty})&&x.end>x.start;
  const explanationFields={commonality:nonempty,difference:nonempty,uncertainty:nonempty,relationKind:one('supplement','support','limit','challenge','alternative','branch','unknown'),question:short};
  // Declining or keeping a candidate is not a writing assignment. Original
  // candidates remain complete; only accepted interpretations need that bar.
  const explanation=x=>shape(x,{...explanationFields,commonality:short,difference:short,uncertainty:short});
  const candidate=x=>shape(x,{id:identity,from:ref,to:ref,kind:one('direct','potential'),...explanationFields,evidence:list(evidence,8)});
  const output=x=>shape(x,{kind:one('relation','question','branch'),id:identity,relationId:optional(identity)});
  const placementPlan={canvasId:canvas,groupId:identity,fromNodeId:identity,toNodeId:identity};
  const placement=x=>shape(x,{...placementPlan,status:one('prepared','confirmed','abandoned'),revision:x=>x===null||integer(x),at:stamp});
  const decision=x=>shape(x,{candidateId:identity,version:integer,decision:one('accepted','saved','rejected','coframe'),interpretation:explanation,note:short,output:optional(output),at:stamp});
  const coverageRefs=x=>list(ref,128)(x)&&new Set(x.map(stable)).size===x.length;
  const coverage=x=>x===null||shape(x,{read:coverageRefs,partial:coverageRefs,unread:coverageRefs});
  const result=x=>shape(x,{source,summary:nonempty,candidates:list(candidate,5),coverage,at:stamp});
  const requestFields={question:short,seeds:unique,pool:unique,excluded:unique,instructions:instructionRefs,limit:x=>integer(x)&&x>=1&&x<=5,canvasId:x=>x===null||canvas(x)};
  const operations={
    'activation.prepare':{id:identity,...requestFields,at:stamp},
    'activation.result':{id:identity,expectedVersion:integer,source,summary:nonempty,candidates:list(candidate,5),coverage,at:stamp},
    'activation.decide':{id:identity,expectedVersion:integer,candidateId:identity,decision:one('accepted','saved','rejected'),interpretation:explanation,note:short,output:optional(output),at:stamp},
    'activation.close':{id:identity,expectedVersion:integer,reason:short,at:stamp},
    'activation.place.prepare':{id:identity,expectedVersion:integer,candidateId:identity,...placementPlan,at:stamp},
    'activation.place.confirm':{id:identity,expectedVersion:integer,candidateId:identity,revision:x=>integer(x)&&x>=1,at:stamp},
    'activation.place.abandon':{id:identity,expectedVersion:integer,candidateId:identity,at:stamp},
  };
  const scope=r=>Object.fromEntries(Object.keys(requestFields).map(k=>[k,structuredClone(r[k])]));
  function checkScope(host,r,forUse=false) {
    need(r.question.trim()||r.seeds.length,'ACTIVATION_INPUT_EMPTY','写下一个问题或选择起点，不会自动发送整图。');
    need(r.pool.length&&r.pool.length<=64,'ACTIVATION_POOL_REQUIRED','明确选择有限的候选材料；未选择的内容不会自动带入。');
    const refs=[...r.seeds,...r.pool];
    need(!r.seeds.some(a=>r.pool.some(b=>overlap(a,b))),'ACTIVATION_ROLE_CONFLICT','起点与候选范围重叠；请明确区分，不自动扩大。');
    need(![...refs,...r.instructions].some(a=>r.excluded.some(b=>overlap(a,b))),'REFERENCE_CONFLICT','本次包含与排除相交，请明确缩小范围。');
    // A question alone still needs a saved evidence anchor for a pair. It is
    // saved by the UI as the user's expression before preparing this request.
    need(r.seeds.length,'ACTIVATION_SEED_REQUIRED','先把问题留下为表达，或明确选择一个起点。');
    for(const v of [...refs,...r.excluded,...r.instructions]){if(forUse&&!includes(r.excluded,v))select(host,v);resolve(host,v,{forUse:forUse&&!includes(r.excluded,v)});}
    for(const v of r.instructions){const {value}=resolve(host,v,{forUse});need(value.usage==='instruction'&&value.prompt?.trim(),'INVALID_INSTRUCTION','本次指令须明确选择可用的指令版本。');}
  }
  function referenceText(host,r) {
    const {value}=resolve(host,r);let text=r.kind==='capability'?JSON.stringify(value):value.text;
    need(typeof text==='string','ACTIVATION_TEXT_UNAVAILABLE','这个准确范围没有保存文字摘录；没有读取或上传整份原件。',409);
    if(r.anchor?.type==='text')text=text.slice(r.anchor.start,r.anchor.end);
    return text;
  }
  function checkCandidate(host,r,c) {
    need(includes(r.seeds,c.from)&&includes(r.pool,c.to),'ACTIVATION_SCOPE_MISMATCH','候选两端必须来自本次冻结的起点与候选范围。');
    need(c.evidence.length>=2&&c.evidence.some(e=>same(e.ref,c.from))&&c.evidence.some(e=>same(e.ref,c.to)),'ACTIVATION_EVIDENCE_REQUIRED','候选两端都需要准确原文依据。');
    for(const e of c.evidence){need(includes([...r.seeds,...r.pool],e.ref),'ACTIVATION_SCOPE_MISMATCH','依据不在本次授权范围。');const t=referenceText(host,e.ref);need(e.end<=t.length&&t.slice(e.start,e.end)===e.quote,'ACTIVATION_QUOTE_MISMATCH','依据必须逐字来自准确版本的保存片段，未修补或猜测。');}
  }
  function checkResult(host,r,value) {
    need(value.candidates.length<=r.limit,'ACTIVATION_LIMIT','候选超过本次限额，未截断成成功结果。');
    need(new Set(value.candidates.map(c=>c.id)).size===value.candidates.length&&new Set(value.candidates.map(c=>stable([c.from,c.to]))).size===value.candidates.length,'ACTIVATION_DUPLICATE','候选身份或两端组合重复。');
    for(const c of value.candidates)checkCandidate(host,r,c);
    if(value.source.kind==='native-result'){
      need(value.coverage,'ACTIVATION_COVERAGE_REQUIRED','AI返回须保留实际读取覆盖范围，未读不等于已比较。');
      const all=[...value.coverage.read,...value.coverage.partial,...value.coverage.unread],expected=[...r.seeds,...r.pool];
      need(all.length===expected.length&&new Set(all.map(stable)).size===all.length&&all.every(v=>includes(expected,v)),'ACTIVATION_COVERAGE_INVALID','实际读取覆盖范围与冻结输入不一致。');
    }else need(value.coverage===null,'ACTIVATION_COVERAGE_INVALID','人工整理不能伪造模型读取证明。');
  }
  const getCandidate=(r,id)=>{const c=r.result?.candidates.find(c=>c.id===id);need(c,'ACTIVATION_CANDIDATE_UNAVAILABLE','没有这个准确候选，未改用其它结果。',409);return c;};
  const currentDecision=(r,id)=>(r.decisions[id]||[]).at(-1);
  function appendDecision(r,c,body){const history=r.decisions[c.id]||[];need(history.length<100,'ACTIVATION_HISTORY_LIMIT','此候选处理历史已达上限；可另起探索，原记录不覆盖。');r.decisions[c.id]=[...history,{candidateId:c.id,version:history.length+1,...structuredClone(body)}];}
  function verifyPlacement(host,r,c,plan,document,revision) {
    need(document&&document.id===plan.canvasId&&document.revision===revision,'ACTIVATION_PLACEMENT_UNVERIFIED','原画布布局修订尚未精确核验，未记录同框成功。',409);
    const group=document.nodes.find(n=>n.id===plan.groupId),a=document.nodes.find(n=>n.id===plan.fromNodeId),b=document.nodes.find(n=>n.id===plan.toNodeId);
    need(group?.ref===null&&a&&b&&a.groupId===group.id&&b.groupId===group.id&&a.id!==b.id&&same(a.ref,c.from)&&same(b.ref,c.to),'ACTIVATION_PLACEMENT_UNVERIFIED','原空间组或准确引用不一致，未把其它布局当作同框成功。',409);
  }
  function verifyLayout(host,canvasId,command){
    if(!command.activation)return;
    const {id,candidateId}=command.activation,r=host?.activations?.[id],p=r?.placements[candidateId];
    need(r?.status==='returned'&&p?.status==='prepared'&&p.canvasId===canvasId,'ACTIVATION_PLACEMENT_STOPPED','原探索或同框意图已结束；没有继续发送新的布局。',409);
    const c=getCandidate(r,candidateId);verifyPlacement(host,r,c,p,{...command.scene,id:canvasId,revision:command.expectedRevision+1},command.expectedRevision+1);
  }
  function apply(host,op,{add,assertVersion,proofs={},placements={}}) {
    host.activations??={};
    if(op.type==='activation.prepare'){
      checkScope(host,op,true);add(host,'activations',op.id,{id:op.id,...scope(op),createdAt:op.at,version:1,status:'prepared',result:null,decisions:{},placements:{},ended:null});return;
    }
    const r=host.activations[op.id];assertVersion(r,op.expectedVersion);
    need(!['closed','cancelled'].includes(r.status)||['activation.place.confirm','activation.place.abandon'].includes(op.type),'ACTIVATION_CLOSED','这次探索已经结束；原记录保留，可另起一次探索。',409);
    if(op.type==='activation.close'){r.status=r.result?'closed':'cancelled';r.ended={reason:op.reason,at:op.at};r.version++;return;}
    if(op.type==='activation.result'){
      need(r.status==='prepared'&&!r.result,'ACTIVATION_RESULT_EXISTS','原结果已经保留，不能静默替换。',409);
      const body={source:structuredClone(op.source),summary:op.summary,candidates:structuredClone(op.candidates),coverage:structuredClone(op.coverage),at:op.at};
      checkResult(host,r,body);
      if(op.source.kind==='native-result'){
        const proof=proofs[op.id];need(proof&&same(proof.request,scope(r))&&same(proof.source,op.source)&&same(proof.summary,op.summary)&&same(proof.candidates,op.candidates)&&same(proof.coverage,op.coverage),'ACTIVATION_RESULT_UNVERIFIED','未从原运行核验输入、返回与实际读取证据，未导入AI候选。',409);
      }
      r.result=body;r.status='returned';r.version++;return;
    }
    const c=getCandidate(r,op.candidateId);
    if(op.type==='activation.place.prepare'){
      const prior=r.placements[c.id];need(!prior||prior.status==='abandoned','ACTIVATION_PLACEMENT_EXISTS','已有同框意图；请核对原请求，不重复放置。',409);
      need(r.canvasId===null||op.canvasId===r.canvasId,'ACTIVATION_CANVAS_MISMATCH','同框目标必须是原探索画布，不随当前页面改变。',409);
      need(new Set([op.groupId,op.fromNodeId,op.toNodeId]).size===3,'ACTIVATION_PLACEMENT_INVALID','同框节点身份不能相同。');
      resolve(host,c.from,{forUse:true});resolve(host,c.to,{forUse:true});
      r.placements[c.id]={...Object.fromEntries(Object.keys(placementPlan).map(k=>[k,op[k]])),status:'prepared',revision:null,at:op.at};r.version++;return;
    }
    if(op.type==='activation.place.abandon'){
      const p=r.placements[c.id];need(p?.status==='prepared','ACTIVATION_PLACEMENT_UNAVAILABLE','没有待继续的同框意图。',409);p.status='abandoned';p.at=op.at;r.version++;return;
    }
    if(op.type==='activation.place.confirm'){
      const p=r.placements[c.id];need(p?.status==='prepared','ACTIVATION_PLACEMENT_UNAVAILABLE','没有待核验的原同框意图。',409);
      verifyPlacement(host,r,c,p,placements[op.id+':'+c.id],op.revision);p.status='confirmed';p.revision=op.revision;p.at=op.at;
      if(currentDecision(r,c.id)?.decision!=='accepted')appendDecision(r,c,{decision:'coframe',interpretation:Object.fromEntries(Object.keys(explanationFields).map(k=>[k,c[k]])),note:'仅空间同框，未认可语义关系',at:op.at});
      r.version++;return;
    }
    need(currentDecision(r,c.id)?.decision!=='accepted','ACTIVATION_ALREADY_ADOPTED','已有采纳输出；请在原关系或表达中修订，不重复创建或暗中撤回。',409);
    if(op.decision==='accepted'){
      need(op.output,'ACTIVATION_OUTPUT_REQUIRED','明确选择采纳为关系、问题或旁支。');resolve(host,c.from,{forUse:true});resolve(host,c.to,{forUse:true});
      const p=op.interpretation,o=op.output,refs=[c.from,c.to];
      need(shape(p,explanationFields),'ACTIVATION_INTERPRETATION_REQUIRED','接受前明确共通点、差异与尚未验证之处；暂存或拒绝不需要填写。');
      if(o.kind!=='relation'){need(p.question.trim(),'ACTIVATION_QUESTION_REQUIRED','请写下要留下的问题。');add(host,'expressions',o.id,{id:o.id,kind:'question',title:p.question.slice(0,96),version:1,versions:{'1':{text:p.question,refs:structuredClone(refs)}},author:'user',status:'current'});}
      if(o.kind!=='question'){
        need(o.kind==='branch'?Boolean(o.relationId):o.relationId===undefined,'ACTIVATION_OUTPUT_INVALID','旁支需要独立关系身份，普通关系不接受另一身份。');
        const id=o.kind==='relation'?o.id:o.relationId,to=o.kind==='relation'?c.to:{kind:'expression',id:o.id,version:1};
        add(host,'relations',id,{id,from:structuredClone(c.from),to:structuredClone(to),reason:p.commonality,evidence:c.evidence.map(e=>e.ref.kind+':'+e.ref.id+' v'+e.ref.version+' ['+e.start+'–'+e.end+'] '+e.quote).join('\n'),difference:p.difference,uncertainty:p.uncertainty,kind:o.kind==='branch'?'branch':p.relationKind,sources:structuredClone(refs),author:r.result.source.kind==='manual'?'user':'agent',modifiedBy:'user',version:1,status:'accepted'});
      }else need(o.relationId===undefined,'ACTIVATION_OUTPUT_INVALID','新问题不会暗中生成语义关系。');
    }else need(op.output===undefined,'ACTIVATION_OUTPUT_INVALID','暂存与拒绝不创建内容或关系。');
    appendDecision(r,c,{decision:op.decision,interpretation:op.interpretation,note:op.note,...(op.output?{output:op.output}:{}),at:op.at});r.version++;
  }
  function validate(host) {
    need(host.activations===undefined||host.activations&&typeof host.activations==='object'&&!Array.isArray(host.activations),'INVALID_ACTIVATION','激活目录无效。');
    for(const [id,r]of Object.entries(host.activations||{})){
      need(shape(r,{id:identity,...requestFields,createdAt:stamp,version:x=>integer(x)&&x>=1,status:one('prepared','returned','closed','cancelled'),result:x=>x===null||result(x),decisions:x=>x&&typeof x==='object'&&!Array.isArray(x),placements:x=>x&&typeof x==='object'&&!Array.isArray(x),ended:x=>x===null||shape(x,{reason:short,at:stamp})})&&r.id===id,'INVALID_ACTIVATION','激活身份、冻结范围或状态无效。');
      checkScope(host,r);need((r.status==='prepared'?r.result===null:r.status==='returned'?r.result!==null:true)&&(r.status==='cancelled'?r.result===null:true)&&(['closed','cancelled'].includes(r.status)?r.ended!==null:r.ended===null),'INVALID_ACTIVATION','激活阶段与实际结果不一致。');
      if(r.result)checkResult(host,r,r.result);
      for(const [cid,history]of Object.entries(r.decisions)){getCandidate(r,cid);need(list(decision,100)(history)&&history.length&&history.every((d,i)=>d.candidateId===cid&&d.version===i+1&&(d.decision==='accepted')===Boolean(d.output)),'INVALID_ACTIVATION','候选处理历史无效。');need(history.every((d,i)=>d.decision!=='accepted'||i===history.length-1),'INVALID_ACTIVATION','已经采纳的输出须在原对象修订，不能以新处理覆盖。');for(const d of history)if(d.output){need(shape(d.interpretation,explanationFields),'INVALID_ACTIVATION','已采纳的解释不完整。');const o=d.output,c=getCandidate(r,cid);if(o.kind!=='relation'){const item=host.expressions[o.id];need(item?.kind==='question'&&item.author==='user'&&item.versions[1]?.text===d.interpretation.question&&same(item.versions[1].refs,[c.from,c.to]),'INVALID_ACTIVATION','问题输出缺少准确原稿或引用。');}if(o.kind!=='question'){const relation=host.relations[o.kind==='relation'?o.id:o.relationId],target=o.kind==='relation'?c.to:{kind:'expression',id:o.id,version:1};need(relation&&same(relation.from,c.from)&&same(relation.to,target),'INVALID_ACTIVATION','关系输出缺少准确两端。');}need(o.kind==='branch'?Boolean(o.relationId):o.relationId===undefined,'INVALID_ACTIVATION','采纳输出包含不匹配的关系身份。');}}
      for(const [cid,p]of Object.entries(r.placements)){getCandidate(r,cid);need(placement(p)&&(p.status==='confirmed'?integer(p.revision)&&p.revision>=1:p.revision===null),'INVALID_ACTIVATION','同框意图或确认修订无效。');}
    }
  }
  function input(host,id) {
    const r=host.activations?.[id];need(r?.status==='prepared','ACTIVATION_NOT_PREPARED','这次探索不可提交，原记录没有改写。',409);checkScope(host,r,true);
    const fragments=[];
    for(const [role,rs]of [['seed',r.seeds],['candidate',r.pool],['instruction',r.instructions]])for(const v of rs){
      need(!v.anchor||v.anchor.type==='text','ACTIVATION_MEDIA_UNREADABLE','当前文本执行器不能读取这个媒体局部；请先人工摘取文字，不会上传原件或扩大范围。',409);
      const {item,value}=resolve(host,v,{forUse:true}),text=role==='instruction'?value.prompt:referenceText(host,v);
      need(text?.trim(),'ACTIVATION_TEXT_UNAVAILABLE','本次准确范围没有可读文字；没有发送整份原件。',409);
      fragments.push({id:role+':'+(fragments.length+1),role,revision:v.version,text,title:item.title,ref:structuredClone(v)});
    }
    const payload={kind:'activation',activationId:id,activation:scope(r),task:{id:'activation-'+id,title:r.question||'激活所选旧线索',goal:r.question||'比较起点与候选材料，寻找有依据的直接呼应或潜在联系',refs:structuredClone([...r.seeds,...r.pool]),excluded:structuredClone(r.excluded),instructions:structuredClone(r.instructions),status:'prepared'},fragments};
    need(new TextEncoder().encode(JSON.stringify(payload)).length<=256*1024,'ACTIVATION_CONTEXT_LIMIT','本次准确范围超过256 KiB，请缩小摘录，不会截断或替换。',409);return payload;
  }
  function parseOutput(payload,result,provided) {
    let raw;try{raw=JSON.parse(result.answer);}catch{need(false,'ACTIVATION_OUTPUT_INVALID','激活返回不是严格JSON；原运行失败，不当成无候选。');}
    const wire=x=>shape(x,{id:identity,from:identity,to:identity,kind:one('direct','potential'),...explanationFields,evidence:x=>list(integer,8)(x)&&new Set(x).size===x.length});
    need(shape(raw,{formatVersion:one(1),summary:nonempty,candidates:list(wire,5)}),'ACTIVATION_OUTPUT_INVALID','激活返回字段或结构无效，没有猜测、修补或截断。');
    need(Array.isArray(provided)&&provided.some(f=>payload.fragments.some(p=>p.id===f.id&&p.role==='seed'))&&provided.some(f=>payload.fragments.some(p=>p.id===f.id&&p.role==='candidate')),'ACTIVATION_OUTPUT_UNREAD','尚无两侧材料的实际读取证明，不能宣称已探索或无候选。');
    const candidates=raw.candidates.map(c=>{
      const a=payload.fragments.find(f=>f.id===c.from),b=payload.fragments.find(f=>f.id===c.to);
      need(a?.role==='seed'&&b?.role==='candidate'&&a.ref&&b.ref&&provided.some(f=>f.id===a.id)&&provided.some(f=>f.id===b.id),'ACTIVATION_OUTPUT_SCOPE','候选两端不是实际读取的起点及候选材料。');
      const evidence=c.evidence.map(i=>{const citation=result.citations[i],f=citation&&payload.fragments.find(f=>f.id===citation.contextId);need(f&&['seed','candidate'].includes(f.role)&&f.ref&&citation.quote?.trim()&&provided.some(read=>read.id===f.id&&read.text.includes(citation.quote))&&f.text.includes(citation.quote),'ACTIVATION_OUTPUT_EVIDENCE','候选依据须引用外层已核验的实际读取citation，不能引用指令或未读材料。');const start=f.text.indexOf(citation.quote);need(start===f.text.lastIndexOf(citation.quote),'ACTIVATION_OUTPUT_AMBIGUOUS','逐字引用在原片段重复，无法确定位置；请返回更长的唯一引用，不猜测定位。');return{ref:structuredClone(f.ref),start,end:start+citation.quote.length,quote:citation.quote};});
      need(evidence.some(e=>same(e.ref,a.ref))&&evidence.some(e=>same(e.ref,b.ref)),'ACTIVATION_OUTPUT_EVIDENCE','候选两端均须有实际读取的逐字证据，不能以空citation导入。');
      return{...c,from:structuredClone(a.ref),to:structuredClone(b.ref),evidence};
    });
    // Validate against the frozen roles too, not just provider-owned IDs.
    need(payload?.kind==='activation'&&raw.candidates.length<=payload.activation.limit,'ACTIVATION_OUTPUT_SCOPE','原请求或候选数不符合冻结范围。');
    need(new Set(candidates.map(c=>c.id)).size===candidates.length&&new Set(candidates.map(c=>stable([c.from,c.to]))).size===candidates.length,'ACTIVATION_DUPLICATE','候选身份或两端组合重复。');
    for(const f of provided)need(shape(f,{id:identity,text:x=>typeof x==='string'})&&payload.fragments.some(p=>p.id===f.id&&p.text.includes(f.text)),'ACTIVATION_OUTPUT_SCOPE','实际读取证明不在原冻结片段中。');
    const coverage={read:[],partial:[],unread:[]};
    for(const f of payload.fragments.filter(f=>['seed','candidate'].includes(f.role))){const reads=provided.filter(p=>p.id===f.id);coverage[reads.some(p=>p.text===f.text)?'read':reads.length?'partial':'unread'].push(structuredClone(f.ref));}
    return{summary:raw.summary,candidates,coverage};
  }
  return{operations,validate,apply,input,scope,referenceText,parseOutput,candidate,explanation,verifyLayout,needsProof:op=>op.type==='activation.result'&&op.source.kind==='native-result'};
}
