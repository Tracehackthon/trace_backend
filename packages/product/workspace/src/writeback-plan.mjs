import {demandWorkbench as need,stableWorkbenchJson as stable,validContentRef} from './workbench-model.mjs';

// One destination builder for direct human writing and reviewed AI returns.
// It does not own storage or execute anything. Source creation, when needed,
// precedes these operations in the same atomic Product command.
export function prepareContentWriteback(host,{id,source,target,expectedVersion,text,title,provenance=undefined}) {
  need(validContentRef(source),'INVALID_REFERENCE','写回需要一个准确保存来源。');
  need(typeof text==='string'&&text.trim()&&typeof title==='string'&&title.trim(),'EMPTY_WRITEBACK','请明确保留的正文和名称。');
  const operations=[],unique=items=>items.filter((r,i,a)=>a.findIndex(x=>stable(x)===stable(r))===i);
  const conflict=message=>need(false,'CONTENT_CONFLICT',message,409);
  const info=provenance||{purpose:'由用户原话发展出的待验证方法',scope:'尚未试用，需继续验证',evidence:'来自明确摘取的用户原话',reason:'用户直接写回原话中的思考',annotationTitle:'摘记',branchEvidence:'用户明确保留的讨论内容'};
  let targetRef,relationRef;
  if(target.kind==='material'){
    const material=host.materials[target.id];need(material,'CONTENT_NOT_FOUND','材料已不可用。',404);
    const materialRef={kind:'material',id:material.id,version:material.version},expressionId='adopted-'+material.id,item=host.expressions[expressionId];
    if((item?.version||0)!==expectedVersion)conflict('材料摘记已有新版本，请重新读取并比较后再写回。');
    need(!item||item.author==='user'&&item.kind==='annotation'&&item.versions[item.version].refs.some(r=>r.kind==='material'&&r.id===material.id),'ORIGINAL_PROTECTED','材料摘记身份冲突，未覆盖。');
    const old=item?.versions[item.version],value={text:old?old.text+'\n\n'+text:text,refs:unique([...(old?.refs||[materialRef]),source])};
    operations.push(item?{type:'expression.edit',id:expressionId,expectedVersion,title:item.title,value}:{type:'expression.create',id:expressionId,kind:'annotation',title:info.annotationTitle+' · '+material.title,author:'user',value});
    targetRef={kind:'expression',id:expressionId,version:expectedVersion+1};
  }else if(target.kind==='capability'){
    const item=host.capabilities[target.id];if(!item||item.version!==expectedVersion)conflict('能力已有新版本，请重新读取并比较后再写回。');
    need(!['disabled','received'].includes(item.status),'CAPABILITY_INACTIVE','目标能力未采用或已停用；没有自动恢复或修改它。');
    const value=structuredClone(item.versions[item.version]);value.steps=value.steps?value.steps+'\n\n'+text:text;value.refs=unique([...value.refs,source]);
    if(value.stepItems)value.stepItems.push({id:'step-'+id,text,checked:false});
    operations.push({type:'capability.edit',id:item.id,expectedVersion,value,reason:info.reason});targetRef={kind:'capability',id:item.id,version:expectedVersion+1};
  }else if(target.kind==='new-capability'){
    need(expectedVersion===0,'CONTENT_CONFLICT','新能力需要尚未创建的基准。',409);
    const cid='cap-'+id;operations.push({type:'capability.create',id:cid,value:{title,purpose:info.purpose,scope:info.scope,steps:text,evidence:info.evidence,examples:'',refs:[source]}});targetRef={kind:'capability',id:cid,version:1};
  }else if(target.kind==='expression'){
    const item=host.expressions[target.id];if(!item||item.version!==expectedVersion)conflict('这条表达已有新版本，请重新读取并比较后再写回。');
    need(item.author==='user'&&item.kind!=='ink'&&['append','replace'].includes(target.mode),'ORIGINAL_PROTECTED','只能明确修订用户文字表达；AI原稿和手绘不会被覆盖。');
    const old=item.versions[item.version],value={text:target.mode==='append'&&old.text?old.text+'\n\n'+text:text,refs:unique([...old.refs,source])};
    operations.push({type:'expression.edit',id:item.id,expectedVersion,title,value});targetRef={kind:'expression',id:item.id,version:expectedVersion+1};
  }else if(target.kind==='new-expression'||target.kind==='branch'){
    need(expectedVersion===0&&['note','question','understanding','attempt'].includes(target.expressionKind),'INVALID_WRITEBACK','请明确新线索、问题、理解或尝试的类型。');
    const eid='return-'+id;operations.push({type:'expression.create',id:eid,kind:target.expressionKind,title,author:'user',value:{text,refs:[source]}});targetRef={kind:'expression',id:eid,version:1};
    if(target.kind==='branch'){
      const rid='branch-'+id;operations.push({type:'relation.create',id:rid,from:target.from,to:targetRef,reason:'从这里另起旁支：'+title,evidence:info.branchEvidence,difference:target.difference||'',uncertainty:target.uncertainty||'',kind:'branch',author:'user',sources:[source]});relationRef={kind:'relation',id:rid,version:1};
    }
  }else if(target.kind==='relation'){
    need(expectedVersion===0,'CONTENT_CONFLICT','新关系需要从尚未创建的基准开始。',409);
    const rid='relation-'+id;operations.push({type:'relation.create',id:rid,from:target.from,to:target.to,reason:text,evidence:target.evidence,difference:target.difference,uncertainty:target.uncertainty,kind:target.relationKind,author:'user',sources:[source]});targetRef={kind:'relation',id:rid,version:1};
  }else need(false,'INVALID_WRITEBACK','请选择明确的写回位置。');
  return {operations,targetRef,...(relationRef?{relationRef}:{})};
}
