import { read, mutate, exportData } from '@/lib/ledger';
function owner(r:Request) { return r.headers.get('oai-authenticated-user-id'); }
function json(x:unknown,status=200){return Response.json(x,{status,headers:{'Cache-Control':'no-store'}})}
export async function GET(r:Request) {const user=owner(r);if(!user)return json({error:'認証が必要です。'},401);try{const state=await read(user);return json({revision:state.revision,...exportData(state.data)});}catch{return json({error:'台帳を読み込めませんでした。'},500)}}
export async function POST(r:Request) {const user=owner(r);if(!user)return json({error:'認証が必要です。'},401);if(r.headers.get('origin')!==new URL(r.url).origin)return json({error:'不正な送信元です。'},403);try{const command=await r.json() as Record<string,unknown>;return json(await mutate(user,command));}catch(e){const msg=e instanceof Error?e.message:'保存に失敗しました。';return json({error:msg==='CONFLICT'?'別の操作で更新されています。再読み込みしてください。':msg},msg==='CONFLICT'?409:400)}}
