import {afterEach,describe,it,expect,vi} from 'vitest'
import {createClient} from '@supabase/supabase-js'
import {loadMarketingData} from './marketingLoad'
import {sellingAccountDataClient} from './marketplaceDataScope'
const client=(fetch:typeof globalThis.fetch)=>sellingAccountDataClient(createClient('https://ads.example.test','test-key',{auth:{persistSession:false,autoRefreshToken:false},global:{fetch}}),'M-TEST',['old-noon','old-amazon'])
afterEach(()=>vi.useRealTimers())
describe('bounded complete advertising snapshot',()=>{
  it('loads all 4928 rows and preserves account filters and complete totals',async()=>{
    const offsets:number[]=[]
    const db=client(async input=>{
      const url=new URL(String(input))
      if(!url.pathname.endsWith('/ad_metrics'))return new Response('[]')
      expect(url.searchParams.get('marketplace_account_id')).toBe('in.(old-noon,old-amazon)')
      const offset=Number(url.searchParams.get('offset'));offsets.push(offset)
      return new Response(JSON.stringify(Array.from({length:Math.min(1000,4928-offset)},(_,i)=>({id:String(offset+i),spend:1}))))
    })
    const r=await loadMarketingData(db,'M-TEST',new AbortController().signal)
    expect(r.data.reduce((s,x)=>s+x.spend,0)).toBe(4928)
    expect(offsets).toEqual([0,1000,2000,3000,4000])
  })
  it('rejects a later page instead of showing partial ad totals',async()=>{
    const db=client(async input=>{
      const url=new URL(String(input))
      if(!url.pathname.endsWith('/ad_metrics'))return new Response('[]')
      return Number(url.searchParams.get('offset'))===0?new Response(JSON.stringify(Array(1000).fill({spend:1}))):new Response('{"message":"permission denied","code":"42501"}',{status:403})
    })
    await expect(loadMarketingData(db,'M-TEST',new AbortController().signal)).rejects.toThrow()
  })
  it('bounds the entire load and aborts stalled sibling requests',async()=>{
    vi.useFakeTimers()
    let cancelled=0
    const db=client(async(_input,init)=>new Promise<Response>((_,reject)=>{
      init?.signal?.addEventListener('abort',()=>{cancelled++;reject(new DOMException('Aborted','AbortError'))},{once:true})
    }))
    const r=loadMarketingData(db,'M-TEST',new AbortController().signal,1000)
    const fail=expect(r).rejects.toThrow('مهلة')
    await vi.advanceTimersByTimeAsync(1000);await fail
    expect(cancelled).toBe(3)
  })
})
