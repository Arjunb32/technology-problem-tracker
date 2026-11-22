// Exercise the packaged Worker with a repeatable Supabase snapshot, without network latency.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import worker from '../apps/api/dist/worker.js';
const fixture=JSON.parse(readFileSync(new URL('../apps/api/src/demo-state.json', import.meta.url),'utf8'));
const snapshot=JSON.stringify(fixture);
globalThis.fetch=async url=>{
  assert.equal(new URL(url instanceof Request?url.url:url).pathname,'/rest/v1/rpc/tracker_snapshot');
  return Response.json(JSON.parse(snapshot));
};
const env={APP_ENV:'production',SUPABASE_URL:'https://fixture.supabase.co',SUPABASE_SERVICE_ROLE_KEY:'fixture',ALLOWED_ORIGINS:'https://site.example',API_PUBLIC_URL:'https://api.example'};
const samples=[];
for(let run=0;run<12;run++){
  const start=performance.now();
  for(let i=0;i<100;i++){
    const res=await worker.fetch(new Request('https://api.example/api/v1/problems/demo-wifi'),env);
    assert.equal(res.status,200);
    const body=await res.json();
    assert.equal(body.problem.affectedCount,2);
    assert.equal(body.solutions[0].currentRevision.tests.length,1);
  }
  if(run) samples.push(performance.now()-start);
}
console.log(JSON.stringify({requests:100,unit:'ms',runs:samples.length,median:samples.toSorted((a,b)=>a-b)[5],samples}));

