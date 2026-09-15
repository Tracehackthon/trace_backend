// Explicit, server-owned reset fixture. Never imported as user evidence or used
// when loading a missing/corrupt workspace. The three examples preserve the UI preset.
import * as B from './bridge.mjs';
const EXAMPLES = [
  {id:'matter-demo-writing',title:'写得不够好就不要动笔',text:'这一周观察自己：每次想写点东西都先怀疑写得不够好，结果一直没动笔。',understanding:'把「写得好」放在「写下来」前面，等于让标准替我按下暂停键。\n\n先写下来，再判断好不好——顺序变了，结果也会变。',stop:'下次想动笔又犹豫时，先问：我是在判断质量，还是在回避开始。'},
  {id:'matter-demo-review',title:'忍住没讲的 review',text:'review 时看到同事在 if-else 里嵌套三层，早就想说但忍住没讲。',understanding:'以后在 review 看到嵌套，先问一句：这层 if 是判断输入，还是在补漏。\n\n把判断说出口，本身就是建立共同标准的一部分。',stop:'下次 review 第一句话留给自己：我想忍的，是判断还是冲突。'},
  {id:'matter-demo-handoff',title:'带入的不仅是内容，还有假设',text:'把 handoff 里项目文档那一份带过去，结果发现对方的实际项目和文档里写的不是一回事。',understanding:'以后带东西给 Agent 或同事之前，先列 3 行这个内容背后我以为成立、但其实没核过的事。\n\n这 3 行不必给对方看，是提醒自己哪些地方可能踩空。',stop:'这次还欠一次复盘：当时的 3 行假设，哪些是真的，哪些是猜的。'},
];
export function createDemoWorkspace() {
  let host = B.createBridge();
  for (const example of EXAMPLES) {
    host = B.captureInput(host, {matterId: example.id, text: example.text});
    for (const action of [{type:'UNDERSTANDING_DRAFT',text:example.understanding},{type:'SAVE_UNDERSTANDING'},{type:'STOP_DRAFT',text:example.stop}])
      host = B.dispatchChain(host, {matterId: example.id, action});
    const matter = host.chain.matters.find(m => m.id === example.id);
    matter.title = `示例 · ${example.title}`;
    matter.origin = 'demo';
  }
  const reasons = ['不是没东西写，是被「够好」这个标准先按住了。','沉默不等于不得罪人；该说的判断不说出口，团队会一起摸不清标准。','内容是显性的，假设是隐性的；不核假设，等于把对方的判断也替了。'];
  host.chain.matters.forEach((matter,index) => { matter.whyCare = reasons[index]; });
  const source = {id:'source-demo-1',kind:'user-observation',origin:'demo',ownerMatterId:'matter-demo-handoff',title:'示例 · 把项目文档带过去的那次',excerpt:'文档里写的是 3 个里程碑，对方的实际项目已经走到了第 5 个。',url:null};
  host.chain.sources.push(source);
  host.chain.sessions['matter-demo-handoff'].incoming = {sourceId:source.id,text:source.excerpt,decision:'linked'};
  host.chain.matters.find(m => m.id === source.ownerMatterId).sourceIds.push(source.id);
  host.chain.selectedId = EXAMPLES[0].id;
  host.chain.screen = 'resume';
  host.route = {view:'home'};
  return host;
}
