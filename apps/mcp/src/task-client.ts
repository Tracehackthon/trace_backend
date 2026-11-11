import fs from 'node:fs';
import path from 'node:path';
import {createHash,createHmac} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import type {Server} from '@modelcontextprotocol/sdk/server/index.js';
import type {RequestId} from '@modelcontextprotocol/sdk/types.js';
import {currentCodexSessionId,resolveBaseUrl,TraceProductClientError} from './product-client.js';

const canonical=(value:unknown):string=>Array.isArray(value)?'['+value.map(canonical).join(',')+']':value!==null&&typeof value==='object'?'{'+Object.entries(value).sort(([a],[b])=>a<b?-1:a>b?1:0).map(([k,v])=>JSON.stringify(k)+':'+canonical(v)).join(',')+'}':JSON.stringify(value);
const hash=(value:unknown)=>createHash('sha256').update(canonical(value)).digest('hex');
const fail=(code:string,message:string):never=>{throw new TraceProductClientError(code,message);};
const localPath=(value:unknown):value is string=>typeof value==='string'&&value.length<=4096&&path.isAbsolute(value)&&!value.startsWith('\\\\')&&!value.startsWith('//')&&!/[\x00-\x1f\x7f]/.test(value);
export interface TaskHostRoot {rootUri:string;clientName:string;observedAt:string}

/** Host-reported allowed root, never a claim that the UI's current project was proved. */
export async function taskHostRoot(server:Server,options:{signal:AbortSignal;requestId:RequestId}):Promise<TaskHostRoot>{
  if(!server.getClientCapabilities()?.roots)fail('HOST_ROOTS_UNAVAILABLE','宿主未提供允许根接口；没有读取或交付任务内容。请先完成明确连接与人工配对。');
  const result=await server.listRoots(undefined,{signal:options.signal,timeout:5000,relatedRequestId:options.requestId});
  if(result.roots.length!==1)fail('HOST_ROOTS_AMBIGUOUS','需要宿主报告唯一明确的允许根；不会从多个目录、启动cwd或环境中猜当前项目。');
  let url:URL;
  try{url=new URL(result.roots[0]!.uri);}catch{fail('HOST_ROOT_INVALID','宿主允许根不是本机file URI。');}
  if(url!.protocol!=='file:'||url!.hostname||url!.username||url!.password||url!.search||url!.hash)fail('HOST_ROOT_INVALID','只接受无网络authority、查询或片段的本机file URI。');
  let directory:string;try{directory=fileURLToPath(url!);}catch{fail('HOST_ROOT_INVALID','宿主允许根不能转换为本机目录。');}
  if(!localPath(directory!))fail('HOST_ROOT_INVALID','不访问UNC或其它非本机目录。');
  return {rootUri:url!.href,clientName:(server.getClientVersion()?.name||'MCP host').slice(0,200),observedAt:new Date().toISOString()};
}

/** Explicit protocol2 connection only. No default4173, unsigned or v1 fallback. */
export class TraceTaskClient {
  readonly sessionId:string;
  private readonly origin:string;
  private readonly ownerId:string;
  private readonly key:Buffer;
  constructor(environment:NodeJS.ProcessEnv=process.env){
    this.sessionId=currentCodexSessionId(environment);
    if(!environment.TRACE_TASK_PRODUCT_URL||!localPath(environment.TRACE_TASK_MCP_KEY_FILE))fail('TASK_BRIDGE_NOT_CONFIGURED','请在Trace中明确配置任务桥接地址和该owner的密钥文件；不会回退旧内容服务。');
    this.origin=resolveBaseUrl(environment.TRACE_TASK_PRODUCT_URL!);
    const file=environment.TRACE_TASK_MCP_KEY_FILE!;
    let key:{ownerId?:unknown;key?:unknown};
    try{const stat=fs.lstatSync(file);if(!stat.isFile()||stat.isSymbolicLink()||stat.size>1024)fail('TASK_BRIDGE_KEY_INVALID','任务桥接密钥身份不正确。');key=JSON.parse(fs.readFileSync(file,'utf8')) as typeof key;}
    catch{fail('TASK_BRIDGE_KEY_UNAVAILABLE','任务桥接密钥不可用；没有替换、读取工作区数据库或尝试无签名回退。');}
    if(typeof key!.ownerId!=='string'||!key!.ownerId||typeof key!.key!=='string'||!/^[a-f0-9]{64}$/.test(key!.key)||Object.keys(key!).some(k=>!['ownerId','key'].includes(k)))fail('TASK_BRIDGE_KEY_INVALID','任务桥接密钥结构不正确。');
    this.ownerId=key!.ownerId as string;this.key=Buffer.from(key!.key as string,'hex');
  }
  private async request(kind:string,input:Record<string,unknown>):Promise<Record<string,any>>{
    // Sign the exact JSON-compatible object that is sent, not an object with
    // extra undefined properties or a caller-provided "verified" flag.
    const value=JSON.parse(JSON.stringify({protocolVersion:2,sessionId:this.sessionId,...input})) as Record<string,unknown>;
    value.commandId='task-'+kind+'-'+hash({ownerId:this.ownerId,...value}).slice(0,56);
    const route='/api/product/task-handoffs/'+kind,signature=createHmac('sha256',this.key).update('trace-task-v2\nPOST\n'+route+'\n'+this.ownerId+'\n'+canonical(value)).digest('hex');
    let response:Response;
    try{response=await fetch(this.origin+route,{method:'POST',headers:{origin:this.origin,'content-type':'application/json','x-trace-task-owner':this.ownerId,'x-trace-task-signature':signature},body:JSON.stringify(value),signal:AbortSignal.timeout(10000)});}
    catch{fail('TASK_BRIDGE_UNAVAILABLE','该任务owner未响应；请核对当前连接，不会向旧服务或其它项目重试。');}
    const result=await response!.json() as Record<string,any>;
    if(!response!.ok)throw new TraceProductClientError(String(result.error?.code||'TASK_BRIDGE_ERROR'),String(result.error?.message||'任务接续未完成。'),response!.status);
    return result;
  }
  prepare(input:{requestId:string;projectDir:string;title:string;goal:string;refs:unknown[];excluded:unknown[];instructions:unknown[]},host:TaskHostRoot){
    const {requestId,...body}=input;
    // The explicit intent key distinguishes a deliberate new task from a
    // retransmission. It is not a session, project or permission assertion.
    return this.request('prepare',{...body,host,intentId:requestId});
  }
  async receive(taskId:string,projectDir:string,host:TaskHostRoot){
    const pending=await this.request('request',{taskId,projectDir,host});
    if(!pending.grant)return {...pending,needsUserConfirmation:true,user_notice:'已登记不含任务正文的接续申请。请在Trace同一任务详情核对会话、允许根和输入后明确确认，再领取。'};
    if(pending.grant.revoked)fail('HANDOFF_REVOKED','原外部许可已撤销，未重新交付内容；历史返回仍可按原回执接回。');
    return this.request('receive',{taskId,projectDir,host,deliveryId:pending.grant.deliveryId,contextHash:pending.grant.contextHash});
  }
  returnResult(input:{taskId:string;projectDir:string;deliveryId:string;contextHash:string;returnId:string;payload:Record<string,unknown>}){
    // No new roots call or fs.stat(projectDir) here: this is the original
    // delivery's historical output, not a request for additional context.
    return this.request('return',input);
  }
}
