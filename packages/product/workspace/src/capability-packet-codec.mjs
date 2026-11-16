// TRCAP001 is an uncompressed, path-free file envelope. Binary originals never
// enter business JSON; this is the original transfer artifact, not another DB.
import {validateCapabilityPacket,stableWorkbenchJson,WorkbenchError,demandWorkbench as need} from './workbench-model.mjs';
export const CAPABILITY_PACKET_MIME='application/vnd.trace.capability';
export const CAPABILITY_PACKET_LIMIT=256*1024*1024;
const MAX_MANIFEST=8*1024*1024,magic=new TextEncoder().encode('TRCAP001');
const digest=async bytes=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),n=>n.toString(16).padStart(2,'0')).join('');
export function parseCapabilityPacket(bytes) {
  need(bytes instanceof Uint8Array&&bytes.byteLength>=12&&bytes.byteLength<=CAPABILITY_PACKET_LIMIT,'INVALID_CAPABILITY_PACKET','版本包大小无效、内容不完整或超过256 MiB。');
  need(magic.every((value,i)=>bytes[i]===value),'UNSUPPORTED_CAPABILITY_PACKET','不是受支持的Trace版本包；未导入内容。');
  const length=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength).getUint32(8,false);
  need(length>0&&length<=MAX_MANIFEST&&12+length<=bytes.byteLength,'INVALID_CAPABILITY_PACKET','版本包说明过大或被截断。');
  let manifest;try{manifest=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes.subarray(12,12+length)));}catch{throw new WorkbenchError('INVALID_CAPABILITY_PACKET','版本包说明不是完整的UTF-8 JSON。');}
  validateCapabilityPacket(manifest);let offset=12+length;
  const assets=manifest.resources.map(resource=>{need(resource.bytes<=CAPABILITY_PACKET_LIMIT&&offset+resource.bytes<=bytes.byteLength,'INVALID_CAPABILITY_PACKET','版本包原件长度越界或缺失。');const value={resource,bytes:bytes.subarray(offset,offset+resource.bytes)};offset+=resource.bytes;return value;});
  need(offset===bytes.byteLength,'INVALID_CAPABILITY_PACKET','版本包包含未声明的尾随内容，未导入。');
  return {manifest,assets};
}
export async function decodeCapabilityPacket(file) {
  need(file instanceof Blob&&file.size<=CAPABILITY_PACKET_LIMIT,'INVALID_CAPABILITY_PACKET','请选择256 MiB以内的版本包。');
  const bytes=new Uint8Array(await file.arrayBuffer()),parsed=parseCapabilityPacket(bytes);
  for(const {resource,bytes}of parsed.assets)need(await digest(bytes)===resource.sha256,'CAPABILITY_PACKET_CORRUPT','版本包内原件完整性检查失败，未导入。');
  return {...parsed,bytes,sha256:await digest(bytes)};
}
export async function encodeCapabilityPacket(manifest,readOriginal) {
  validateCapabilityPacket(manifest);const body=new TextEncoder().encode(stableWorkbenchJson(manifest));
  need(body.byteLength<=MAX_MANIFEST,'CAPABILITY_PACKET_TOO_LARGE','版本包说明超过8 MiB；请明确减少分享范围。');
  const total=12+body.byteLength+manifest.resources.reduce((n,r)=>n+r.bytes,0);
  need(total<=CAPABILITY_PACKET_LIMIT,'CAPABILITY_PACKET_TOO_LARGE','版本包连同原件超过256 MiB；未截断或静默排除来源。');
  const head=new Uint8Array(12);head.set(magic);new DataView(head.buffer).setUint32(8,body.byteLength,false);const parts=[head,body];
  for(const resource of manifest.resources){const blob=await readOriginal(resource.id),bytes=new Uint8Array(await blob.arrayBuffer());need(bytes.byteLength===resource.bytes&&await digest(bytes)===resource.sha256,'RESOURCE_UNAVAILABLE','分享原件缺失、长度或hash不一致，未生成替代来源。');parts.push(bytes);}
  return new Blob(parts,{type:CAPABILITY_PACKET_MIME});
}
export function assertCapabilityPacketOperation(op,bytes,hash) {
  const parsed=parseCapabilityPacket(bytes);need(stableWorkbenchJson(parsed.manifest)===stableWorkbenchJson(op.manifest),'PACKET_CONTENT_CONFLICT','命令说明与版本包原件不一致，未提交。',409);
  for(const {resource,bytes}of parsed.assets)need(hash(bytes)===resource.sha256,'CAPABILITY_PACKET_CORRUPT','版本包中的原件hash不一致。');
  return parsed;
}
