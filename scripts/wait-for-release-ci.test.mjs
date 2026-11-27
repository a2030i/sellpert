import { test } from 'node:test'
import assert from 'node:assert/strict'
import { waitForReleaseCI, validateReleaseContext } from './wait-for-release-ci.mjs'
const context = { repository:'a2030i/sellpert', sha:'a'.repeat(40), ref:'refs/heads/main', event:'push', token:'synthetic-test-token' }
const run = (overrides={}) => ({id:1,head_sha:context.sha,head_branch:'main',event:'push',status:'completed',conclusion:'success',...overrides})
function fixture(batches) {
  let clock=0,calls=0
  return {now:()=>clock,sleep:async ms=>{clock+=ms},intervalMs:1,timeoutMs:4,fetchImpl:async()=>({ok:true,json:async()=>({workflow_runs:batches[Math.min(calls++,batches.length-1)]})})}
}
test('only production refs and this repository can obtain release permission',()=>{
 for(const mutation of [{ref:'refs/heads/feature'},{event:'pull_request'},{repository:'other/repo'},{sha:'main'}])assert.throws(()=>validateReleaseContext({...context,...mutation}))
})
test('waits for CI completion of the exact SHA',async()=>{
 const result=await waitForReleaseCI(context,fixture([[],[run({status:'in_progress',conclusion:null})],[run()]]));assert.equal(result.sha,context.sha)
})
test('another commit, branch, or PR result cannot authorize a release',async()=>{
 for(const mutation of [{head_sha:'b'.repeat(40)},{head_branch:'feature'},{event:'pull_request'}])await assert.rejects(waitForReleaseCI(context,fixture([[run(mutation)]])),/Timed out/)
})
test('failed, cancelled, skipped and neutral CI all block deployment',async()=>{
 for(const conclusion of ['failure','cancelled','skipped','neutral',null])await assert.rejects(waitForReleaseCI(context,fixture([[run({conclusion})]])),/did not pass/)
})
test('newest run wins over an older successful run',async()=>{
 await assert.rejects(waitForReleaseCI(context,fixture([[run(),run({id:2,conclusion:'failure'})]])),/did not pass/)
})
test('API access failures never become approval',async()=>{
 await assert.rejects(waitForReleaseCI(context,{...fixture([[]]),fetchImpl:async()=>({ok:false,status:403})}),/HTTP 403/)
 await assert.rejects(waitForReleaseCI({...context,token:''},fixture([[]])),/Missing/)
})
test('manual production releases still require passing push CI',async()=>{
 assert.equal((await waitForReleaseCI({...context,event:'workflow_dispatch'},fixture([[run()]]))).runId,1)
})
