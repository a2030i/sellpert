import { accountScopedClient, requireMarketplaceAccount, resolveMarketplaceAccount } from './marketplaceAccountScope.ts'
const account={id:'b5200000-0000-4000-8000-000000000011',merchant_code:'QA-A',platform:'amazon',status:'active'}
function assert(value:unknown,message:string){if(!value)throw new Error(message)}
function fake(data:unknown=null){
  const calls:any[]=[]
  const query:any={}
  for(const method of ['select','eq','in','limit','update','insert','upsert','delete'])query[method]=(...args:any[])=>{calls.push([method,...args]);return query}
  query.maybeSingle=async()=>({data,error:null})
  query.then=(resolve:any)=>Promise.resolve({data,error:null}).then(resolve)
  return {calls,client:{from:(name:string)=>{calls.push(['from',name]);return query},rpc:(...args:any[])=>{calls.push(['rpc',...args]);return Promise.resolve({data,error:null})}}}
}
Deno.test('server scope adds both tenant and account to reads and mutations',()=>{
 const {client,calls}=fake();const scoped=accountScopedClient(client,account)
 scoped.from('orders').select('order_id').eq('status','pending')
 scoped.from('orders').update({status:'shipped'}).eq('order_id','same-reference')
 scoped.from('orders').delete().eq('order_id','same-reference')
 assert(calls.filter(c=>c[0]==='eq'&&c[1]==='merchant_code'&&c[2]==='QA-A').length===3,'tenant filter missing')
 assert(calls.filter(c=>c[0]==='eq'&&c[1]==='marketplace_account_id'&&c[2]===account.id).length===3,'account filter missing')
})
Deno.test('provider upserts cannot collide with another seller or forge lineage',()=>{
 const {client,calls}=fake();const scoped=accountScopedClient(client,account)
 scoped.from('orders').upsert({order_id:'same-reference',platform:'amazon'},{onConflict:'merchant_code,platform,order_id'})
 const call=calls.find(c=>c[0]==='upsert')
 assert(call[1].marketplace_account_id===account.id&&call[2].onConflict.endsWith(',marketplace_account_id'),'account-aware conflict key missing')
 for(const row of [{merchant_code:'QA-B'},{marketplace_account_id:'another'},{platform:'salla'}]){
  let rejected=false;try{scoped.from('orders').insert(row)}catch{rejected=true}assert(rejected,'foreign source accepted')
 }
})
Deno.test('account authorization fails closed on missing, inactive and ambiguous accounts',async()=>{
 for(const data of [null,{...account,status:'disconnected'}]){
  let rejected=false;try{await requireMarketplaceAccount(fake(data).client,'QA-A','amazon',account.id)}catch{rejected=true}assert(rejected,'unavailable account accepted')
 }
 let rejected=false;try{await resolveMarketplaceAccount(fake([account,{...account,id:'other'}]).client,'QA-A','amazon',undefined)}catch{rejected=true}
 assert(rejected,'ambiguous seller silently selected')
 const {client,calls}=fake(account);await requireMarketplaceAccount(client,'QA-A','amazon',account.id)
 assert(calls.some(c=>c[0]==='eq'&&c[1]==='is_legacy'&&c[2]===false),'legacy source can be linked as verified seller')
})
Deno.test('product ingestion RPC binds the verified account and rejects another workspace',async()=>{
 const {client,calls}=fake([]);const scoped=accountScopedClient(client,account)
 await scoped.rpc('upsert_marketplace_products',{p_merchant_code:'QA-A',p_account_id:'forged',p_rows:[]})
 assert(calls[0][2].p_account_id===account.id,'RPC accepted unverified account')
 let rejected=false;try{await scoped.rpc('upsert_marketplace_products',{p_merchant_code:'QA-B',p_rows:[]})}catch{rejected=true}
 assert(rejected,'RPC crossed workspace')
})
