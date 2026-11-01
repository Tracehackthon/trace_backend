// Node-only resources and independent layout transactions, owned by Product.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {WorkbenchError,demandWorkbench as need,stableWorkbenchJson,resolveContentRef,freezeCanvasContentRef,verifyActivationLayout} from './workbench-model.mjs';
import {emptyCanvas,applyCanvasCommand,validateCanvasCommand,validateCanvasDocument} from './canvas-model.mjs';
export const CANVAS_TABLES=['product_resources','product_canvases','product_canvas_commands'];
export function ensureCanvasSchema(db) {db.exec(`CREATE TABLE IF NOT EXISTS product_resources(id TEXT PRIMARY KEY,metadata TEXT NOT NULL,metadata_hash TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS product_canvases(id TEXT PRIMARY KEY,document TEXT NOT NULL,document_hash TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS product_canvas_commands(canvas_id TEXT NOT NULL,command_id TEXT NOT NULL,fingerprint TEXT NOT NULL,result TEXT NOT NULL,PRIMARY KEY(canvas_id,command_id));`);}
const sha=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
const id=x=>typeof x==='string'&&/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/.test(x);
const mime=x=>typeof x==='string'&&/^[\w.+-]+\/[\w.+-]+$/.test(x);
const MAX_RESOURCE=256*1024*1024;
export function createCanvasResourceStore({db,directory,readProduct,transaction}) {
  const root=path.resolve(directory);
  function rootReady(){fs.mkdirSync(root,{recursive:true});need(!fs.lstatSync(root).isSymbolicLink(),'RESOURCE_PATH_UNSAFE','资源目录不能是符号链接。',503);}
  function readResource(resourceId){need(/^[a-f0-9]{64}$/.test(resourceId),'INVALID_RESOURCE','原件ID不正确。',400);const row=db.prepare('SELECT metadata,metadata_hash FROM product_resources WHERE id=?').get(resourceId);need(row,'RESOURCE_UNAVAILABLE','原件不可用，已保存摘录不受影响。',404);need(sha(row.metadata)===row.metadata_hash,'RESOURCE_CORRUPT','原件元信息损坏。',503);return JSON.parse(row.metadata);}
  function saveResource(bytes,type) {
    need(Buffer.isBuffer(bytes)&&bytes.length<=MAX_RESOURCE&&mime(type),'INVALID_RESOURCE','原件格式不正确或超过256 MiB。',413);
    const hash=sha(bytes),metadata={id:hash,sha256:hash,mime:type,bytes:bytes.length};rootReady();const file=path.join(root,hash);
    if(fs.existsSync(file))need(!fs.lstatSync(file).isSymbolicLink()&&sha(fs.readFileSync(file))===hash,'RESOURCE_CORRUPT','同一原件文件损坏，未覆盖。',503);else fs.writeFileSync(file,bytes,{flag:'wx'});
    return transaction(()=>{const known=db.prepare('SELECT metadata,metadata_hash FROM product_resources WHERE id=?').get(hash);if(known){const existing=readResource(hash);need(existing.bytes===metadata.bytes,'RESOURCE_CONFLICT','原件身份冲突。',409);return existing;}const value=stableWorkbenchJson(metadata);db.prepare('INSERT INTO product_resources(id,metadata,metadata_hash) VALUES(?,?,?)').run(hash,value,sha(value));return metadata;});
  }
  function verifyResources(host,ids){if(host?.schemaVersion!==2)return;for(const resourceId of ids){const resource=host.resources[resourceId],stored=readResource(resourceId);need(stableWorkbenchJson(stored)===stableWorkbenchJson(resource),'RESOURCE_CONFLICT','原件元信息与已保存文件不一致。',409);const file=path.join(root,resource.id);need(fs.existsSync(file)&&!fs.lstatSync(file).isSymbolicLink()&&fs.statSync(file).size===resource.bytes,'RESOURCE_UNAVAILABLE','原件文件尚未完整保存。',409);need(sha(fs.readFileSync(file))===resource.sha256,'RESOURCE_CORRUPT','原件完整性核验失败；未提交新引用。',503);}}
  function readResourceContent(resourceId){const resource=readResource(resourceId);rootReady();const file=path.join(root,resourceId);need(fs.existsSync(file)&&!fs.lstatSync(file).isSymbolicLink(),'RESOURCE_UNAVAILABLE','原件文件不可用。',404);const bytes=fs.readFileSync(file);need(bytes.length===resource.bytes&&sha(bytes)===resource.sha256,'RESOURCE_CORRUPT','原件完整性检查失败。',503);return {resource,bytes};}
  function getCanvas(canvasId){need(id(canvasId),'INVALID_CANVAS_ID','画布ID不正确。',400);const row=db.prepare('SELECT document,document_hash FROM product_canvases WHERE id=?').get(canvasId);if(!row)return emptyCanvas(canvasId);need(sha(row.document)===row.document_hash,'CANVAS_CORRUPT','画布数据损坏，未重置。',503);const doc=JSON.parse(row.document);validateCanvasDocument(doc);need(doc.id===canvasId,'CANVAS_CORRUPT','画布身份不一致。',503);return doc;}
  function listCanvases(){return db.prepare('SELECT id FROM product_canvases ORDER BY rowid').all().map(({id})=>{const d=getCanvas(id);return {id,title:d.title,revision:d.revision};});}
  function executeCanvas(canvasId,command){need(id(canvasId),'INVALID_CANVAS_ID','画布ID不正确。',400);validateCanvasCommand(command);const fingerprint=sha(stableWorkbenchJson(command));return transaction(()=>{const prior=db.prepare('SELECT fingerprint,result FROM product_canvas_commands WHERE canvas_id=? AND command_id=?').get(canvasId,command.commandId);if(prior){need(prior.fingerprint===fingerprint,'COMMAND_CONFLICT','同一布局命令ID不能对应不同操作。',409);return {...JSON.parse(prior.result),headRevision:getCanvas(canvasId).revision};}const before=getCanvas(canvasId),after=applyCanvasCommand(before,command),host=readProduct().host;need(host?.schemaVersion===2,'CONTENT_UPGRADE_REQUIRED','请先准备新内容工作区。',409);verifyActivationLayout(host,canvasId,command);for(const node of after.nodes)if(node.ref)resolveContentRef(host,freezeCanvasContentRef(host,node.ref));for(const edge of after.connections)if(edge.relationId)need(Object.hasOwn(host.relations,edge.relationId),'RELATION_UNAVAILABLE','语义关系不存在。',409);const result={document:after,receipt:{commandId:command.commandId,beforeRevision:before.revision,afterRevision:after.revision,status:'committed'}};const body=stableWorkbenchJson(after);db.prepare('INSERT INTO product_canvases(id,document,document_hash) VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET document=excluded.document,document_hash=excluded.document_hash').run(canvasId,body,sha(body));db.prepare('INSERT INTO product_canvas_commands(canvas_id,command_id,fingerprint,result) VALUES(?,?,?,?)').run(canvasId,command.commandId,fingerprint,stableWorkbenchJson(result));return result;});}
  async function handle(req,res,rawPath,readJson){
    if(rawPath==='/api/product/canvases'&&req.method==='GET'){json(res,200,{items:listCanvases()});return true;}
    const cm=/^\/api\/product\/canvases\/([a-zA-Z0-9_-]+)(\/commands)?$/.exec(rawPath);
    if(cm){if(!cm[2]&&req.method==='GET')json(res,200,{document:getCanvas(cm[1])});else if(cm[2]&&req.method==='POST')json(res,200,executeCanvas(cm[1],await readJson(req)));else json(res,405,{error:{code:'METHOD_NOT_ALLOWED',message:'不支持这个画布操作。'}});return true;}
    if(rawPath==='/api/product/resources'&&req.method==='POST'){
      need(!req.headers['content-encoding']||req.headers['content-encoding']==='identity','INVALID_RESOURCE','不接受压缩资源请求。',415);
      const type=(req.headers['content-type']||'application/octet-stream').split(';')[0];const length=req.headers['content-length'];if(length!==undefined)need(/^\d+$/.test(length)&&Number(length)<=MAX_RESOURCE,'RESOURCE_TOO_LARGE','原件超过256 MiB。',413);
      const bytes=await new Promise((resolve,reject)=>{const chunks=[];let size=0;const timer=setTimeout(()=>{req.destroy();reject(new WorkbenchError('RESOURCE_TIMEOUT','原件接收超时，未登记保存。',408));},30000);req.on('data',chunk=>{size+=chunk.length;if(size>MAX_RESOURCE){clearTimeout(timer);reject(new WorkbenchError('RESOURCE_TOO_LARGE','原件超过256 MiB。',413));req.destroy();}else chunks.push(chunk);});req.on('end',()=>{clearTimeout(timer);resolve(Buffer.concat(chunks));});req.on('error',error=>{clearTimeout(timer);reject(error);});req.on('aborted',()=>{clearTimeout(timer);reject(new WorkbenchError('RESOURCE_INTERRUPTED','原件上传中断，未登记保存。',400));});});json(res,201,{resource:saveResource(bytes,type)});return true;
    }
    const rm=/^\/api\/product\/resources\/([a-f0-9]{64})(\/content)?$/.exec(rawPath);
    if(rm&&req.method==='GET'){
      const metadata=readResource(rm[1]);if(!rm[2]){json(res,200,{resource:metadata});return true;}rootReady();const file=path.join(root,rm[1]);need(fs.existsSync(file)&&!fs.lstatSync(file).isSymbolicLink(),'RESOURCE_UNAVAILABLE','原件文件不可用。',404);const bytes=fs.readFileSync(file);need(bytes.length===metadata.bytes&&sha(bytes)===metadata.sha256,'RESOURCE_CORRUPT','原件完整性核验失败。',503);
      const headers={'content-type':metadata.mime,'x-content-type-options':'nosniff','cross-origin-resource-policy':'same-origin','cache-control':'no-store','accept-ranges':'bytes','content-security-policy':"default-src 'none'; sandbox"};let start=0,end=bytes.length-1,status=200;
      if(req.headers.range){const m=/^bytes=(\d*)-(\d*)$/.exec(req.headers.range);need(m&&(m[1]||m[2]),'INVALID_RANGE','不支持这个资源范围。',416);if(!m[1])start=Math.max(0,bytes.length-Number(m[2]));else start=Number(m[1]);if(m[1]&&m[2])end=Math.min(end,Number(m[2]));need(Number.isSafeInteger(start)&&Number.isSafeInteger(end)&&start>=0&&start<=end&&end<bytes.length,'INVALID_RANGE','资源范围不存在。',416);status=206;headers['content-range']=`bytes ${start}-${end}/${bytes.length}`;}
      const body=bytes.subarray(start,end+1);res.writeHead(status,{...headers,'content-length':body.length});res.end(body);return true;
    }
    return false;
  }
  return {saveResource,readResource,readResourceContent,verifyResources,getCanvas,listCanvases,executeCanvas,handle};
}
function json(res,status,value){res.writeHead(status,{'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff'});res.end(JSON.stringify(value));}
