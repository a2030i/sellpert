import test from 'node:test'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {readBundle,digest,FUNCTIONS,PROJECT,requireWorkflowSource,run} from './coordinated-release.mjs'
const source='1'.repeat(40)
const env={GITHUB_REPOSITORY:'a2030i/sellpert',GITHUB_REF:'refs/heads/fix/operational-reliability',GITHUB_SHA:source}
const fixture=overrides=>JSON.stringify({project:PROJECT,backup_check:'explicitly_waived_by_owner',functions:FUNCTIONS,files:{'a.sql':digest('select 1')},...overrides})
const reader=raw=>async url=>url.pathname.endsWith('execution-manifest.json')?raw:'select 1'
test('immutable bundle validates every SQL artifact',async()=>{const raw=fixture();assert.equal((await readBundle(digest(raw),reader(raw))).project,PROJECT)})
test('edited manifest cannot authorize a different bundle',async()=>{await assert.rejects(readBundle('0'.repeat(64),reader(fixture())),/MANIFEST_MISMATCH/)})
test('SQL edits fail before execution',async()=>{const raw=fixture({files:{'a.sql':digest('select 2')}});await assert.rejects(readBundle(digest(raw),reader(raw)),/ARTIFACT_MISMATCH/)})
for(const path of ['../outside.sql','/outside.sql']) test(`reject artifact path ${path}`,async()=>{const raw=fixture({files:{[path]:digest('select 1')}});await assert.rejects(readBundle(digest(raw),reader(raw)),/ARTIFACT_MISMATCH/)})
for(const overrides of [{project:'other'},{functions:FUNCTIONS.slice(1)},{backup_check:'not_waived'}]) test(`reject changed scope ${Object.keys(overrides)}`,async()=>{const raw=fixture(overrides);await assert.rejects(readBundle(digest(raw),reader(raw)),/SCOPE_MISMATCH/)})
test('only exact authorized branch and commit can execute',()=>{assert.equal(requireWorkflowSource(env,()=>source),source);for(const changed of [{GITHUB_REPOSITORY:'other/repo'},{GITHUB_REF:'refs/heads/main'},{GITHUB_SHA:'2'.repeat(40)}]) assert.throws(()=>requireWorkflowSource({...env,...changed},()=>source),/SOURCE_MISMATCH/)})
test('unknown mode cannot initiate requests',async()=>{await assert.rejects(run({mode:'force'}),/INVALID_MODE/)})
test('checked-in dispatch pins a complete bundle',async()=>{const dispatch=JSON.parse(await readFile(new URL('./releases/coordinated-20261127/dispatch.json',import.meta.url)));const manifest=await readBundle(dispatch.manifest_sha256);assert.equal(manifest.all_versions.length,376);for(const name of ['enter','recover','resume','verify-final','inspect-before','recovery-inspect']) assert.ok(manifest.files[`scripts/releases/coordinated-20261127/${name}.sql`])})
