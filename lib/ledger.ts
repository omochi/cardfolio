import { env } from 'cloudflare:workers';

type Card = { id: string; name: string; purpose: string; expiry: string; archived?: boolean };
type Service = { id: string; name: string; memo: string; archived?: boolean };
type Link = { id: string; cardId: string; serviceId: string; archived?: boolean };
type Generation = { id: string; cardId: string; expiry: string };
type Progress = { linkId: string; generationId: string; status: string; memo: string };
type Ledger = { cards: Card[]; services: Service[]; links: Link[]; generations: Generation[]; progress: Progress[]; operations: {id:string; fingerprint:string}[] };
const empty = (): Ledger => ({cards:[], services:[], links:[], generations:[], progress:[], operations:[]});
const statuses = ['unconfirmed','needed','updated','automatic'];
const id = () => crypto.randomUUID();
function safe(value: unknown, max = 200): string {
  if (typeof value !== 'string' || value.length > max || /(?:\d[ -]?){12,}/.test(value) || /\b(?:password|cvv|cvc|security code|pin|token|secret)\b/i.test(value)) throw new Error('入力内容を確認してください。カード番号や認証情報は保存できません。');
  return value.trim();
}
function required(v: unknown): string { const s = safe(v); if (!s) throw new Error('必須項目を入力してください。'); return s; }
function expiry(v: unknown): string { const s = required(v); if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(s)) throw new Error('有効期限は YYYY-MM で入力してください。'); return s; }
function archiveValue(v: unknown) { if (v !== undefined && typeof v !== 'boolean') throw new Error('無効化状態が不正です。'); }
function get<T extends {id:string}>(list:T[], value:unknown): T { const item=list.find(x=>x.id===value); if(!item) throw new Error('対象が見つかりません。'); return item; }
export async function read(owner:string) {
  if (!env.DB) throw new Error('D1 が設定されていません。');
  const row = await env.DB.prepare('SELECT revision, data FROM ledgers WHERE owner = ?').bind(owner).first<{revision:number;data:string}>();
  return row ? { revision: row.revision, data: JSON.parse(row.data) as Ledger } : {revision:0,data:empty()};
}
function validateRestore(raw: unknown): Ledger {
  if (!raw || typeof raw !== 'object') throw new Error('バックアップの形式が不正です。');
  const d=raw as Ledger;
  for (const key of ['cards','services','links','generations','progress'] as const) if (!Array.isArray(d[key]) || d[key].length > 10000) throw new Error('バックアップの形式が不正です。');
  const ids = (a:{id:string}[])=> {const s=new Set<string>(); for(const x of a) {if (!x || typeof x.id !== 'string' || !x.id || s.has(x.id)) throw new Error('IDが不正または重複しています。'); s.add(x.id)} };
  ids(d.cards); ids(d.services); ids(d.links); ids(d.generations);
  d.cards.forEach(c=>{required(c.name); safe(c.purpose); expiry(c.expiry); archiveValue(c.archived)});
  d.services.forEach(s=>{required(s.name);safe(s.memo,1000);archiveValue(s.archived)});
  const pairs=new Set<string>(); d.links.forEach(l=>{archiveValue(l.archived);get(d.cards,l.cardId);get(d.services,l.serviceId);const p=l.cardId+'|'+l.serviceId;if(pairs.has(p)) throw new Error('紐づけが重複しています。');pairs.add(p)});
  const gens=new Set<string>(); d.generations.forEach(g=>{get(d.cards,g.cardId);expiry(g.expiry);const p=g.cardId+'|'+g.expiry;if(gens.has(p))throw new Error('更新世代が重複しています。');gens.add(p)});
  const ps=new Set<string>(); d.progress.forEach(p=>{const l=get(d.links,p.linkId),g=get(d.generations,p.generationId);if(l.cardId!==g.cardId || !statuses.includes(p.status))throw new Error('進捗が不正です。');safe(p.memo,1000);const k=p.linkId+'|'+p.generationId;if(ps.has(k))throw new Error('進捗が重複しています。');ps.add(k)});
  // 既知のフィールドだけをコピーし、操作キーや未知のプロパティは取り込まない。
  return {cards:d.cards.map(({id,name,purpose,expiry,archived})=>({id,name,purpose,expiry,archived:archived??false})),services:d.services.map(({id,name,memo,archived})=>({id,name,memo,archived:archived??false})),links:d.links.map(({id,cardId,serviceId,archived})=>({id,cardId,serviceId,archived:archived??false})),generations:d.generations.map(({id,cardId,expiry})=>({id,cardId,expiry})),progress:d.progress.map(({linkId,generationId,status,memo})=>({linkId,generationId,status,memo})),operations:[]};
}
export async function mutate(owner:string, command:Record<string,unknown>) {
  const op=required(command.operationId); if(op.length>100) throw new Error('操作IDが長すぎます。');
  const state=await read(owner); const d=state.data;
  const payload=JSON.stringify(Object.fromEntries(Object.entries(command).filter(([key])=>key!=='revision' && key!=='operationId').sort(([a],[b])=>a.localeCompare(b))));
  const fingerprint=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(payload))),b=>b.toString(16).padStart(2,'0')).join('');
  const prior=d.operations.find(x=>x.id===op); if(prior) { if(prior.fingerprint!==fingerprint) throw new Error('操作IDが別の操作に使用されています。'); return {revision:state.revision, duplicate:true}; }
  if(!Number.isInteger(command.revision) || command.revision!==state.revision) throw new Error('CONFLICT');
  switch(command.action) {
    case 'card': {const name=required(command.name), purpose=safe(command.purpose ?? ''), exp=expiry(command.expiry); const c={id:id(),name,purpose,expiry:exp,archived:false}; d.cards.push(c);d.generations.push({id:id(),cardId:c.id,expiry:exp});break}
    case 'service': d.services.push({id:id(),name:required(command.name),memo:safe(command.memo??'',1000),archived:false});break;
    case 'edit_card': {const c=get(d.cards,command.cardId);c.name=required(command.name);c.purpose=safe(command.purpose??'');break}
    case 'edit_service': {const s=get(d.services,command.serviceId);s.name=required(command.name);s.memo=safe(command.memo??'',1000);break}
    case 'archive': {if(typeof command.archived!=='boolean')throw new Error('無効化状態が不正です。');const list: {id:string;archived?:boolean}[]|null=command.kind==='card'?d.cards:command.kind==='service'?d.services:command.kind==='link'?d.links:null;if(!list)throw new Error('対象が不正です。');get(list,command.id).archived=command.archived;break}
    case 'link': {const c=get(d.cards,command.cardId),s=get(d.services,command.serviceId);if(c.archived||s.archived)throw new Error('無効化された項目には紐づけできません。');if(d.links.some(x=>x.cardId===c.id&&x.serviceId===s.id))throw new Error('既に登録されています。');d.links.push({id:id(),cardId:c.id,serviceId:s.id,archived:false});break}
    case 'generation': {const c=get(d.cards,command.cardId), exp=expiry(command.expiry);if(c.archived)throw new Error('無効化されたカードです。');if(d.generations.some(x=>x.cardId===c.id&&x.expiry===exp))throw new Error('その有効期限は既に登録されています。'); if(exp<=c.expiry)throw new Error('現在より後の有効期限を入力してください。');d.generations.push({id:id(),cardId:c.id,expiry:exp});c.expiry=exp;break}
    case 'progress': {const l=get(d.links,command.linkId),g=get(d.generations,command.generationId);if(l.archived||get(d.cards,l.cardId).archived||get(d.services,l.serviceId).archived)throw new Error('無効化された項目です。');if(l.cardId!==g.cardId)throw new Error('カードが一致しません。');const status=required(command.status);if(!statuses.includes(status))throw new Error('状態が不正です。');if((status==='updated'||status==='automatic') && command.confirmed!==true)throw new Error('外部サービスでの確認が必要です。');const p=d.progress.find(x=>x.linkId===l.id&&x.generationId===g.id);const value={linkId:l.id,generationId:g.id,status,memo:safe(command.memo??'',1000)};if(p)Object.assign(p,value);else d.progress.push(value);break}
    case 'restore': {const imported=validateRestore(command.data); Object.assign(d,imported);break}
    default: throw new Error('不明な操作です。');
  }
  d.operations.push({id:op,fingerprint});
  if (JSON.stringify(d).length>1000000) throw new Error('台帳の容量上限を超えました。');
  if (!env.DB) throw new Error('D1 が設定されていません。');
  const result=await env.DB.prepare('INSERT INTO ledgers (owner, revision, data) VALUES (?, 1, ?) ON CONFLICT(owner) DO UPDATE SET revision = revision + 1, data = excluded.data WHERE revision = ?').bind(owner,JSON.stringify(d),state.revision).run();
  if (!result.meta.changes) throw new Error('CONFLICT');
  return {revision:state.revision+1,duplicate:false};
}
export function exportData(data:Ledger) { const {operations: _operations,...rest}=data;return {format:'cardfolio',version:1,data:rest}; }
