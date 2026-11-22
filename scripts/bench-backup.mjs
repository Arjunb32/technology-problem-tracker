import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {mkdirSync,mkdtempSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {performance} from 'node:perf_hooks';

const command = process.argv.slice(2);
if (!command.length) throw new Error('Supply a verifier command and its fixed arguments.');
const directory = mkdtempSync(join(tmpdir(), 'tracker-benchmark-'));
try {
  for (const [count, bytes] of [[1, 256], [128, 32768], [2, 16 * 1024 * 1024]]) {
    const folder = join(directory, String(count));
    mkdirSync(folder);
    const data = Buffer.alloc(bytes, 0x5a);
    const sha256 = createHash('sha256').update(data).digest('hex');
    const files = Array.from({length:count}, (_,i) => {
      const file = i+'.bin';
      writeFileSync(join(folder,file),data);
      return {file,objectPath:'owner/'+file,bytes,sha256};
    });
    writeFileSync(join(folder,'manifest.json'),JSON.stringify({version:1,complete:true,kind:'media',bucket:'tracker-images',files}));
    const samples=[];
    for(let i=0;i<12;i++) {
      const start=performance.now();
      const result=spawnSync(command[0],[...command.slice(1),'--dir',folder],{encoding:'utf8'});
      const elapsed=performance.now()-start;
      assert.equal(result.status,0,result.stderr || String(result.error));
      assert.match(result.stdout,new RegExp('Verified media backup: '+count+' files'));
      if(i) samples.push(elapsed);
    }
    console.log(JSON.stringify({count,bytes,unit:'ms',runs:samples.length,median:samples.toSorted((a,b)=>a-b)[5],samples}));
  }
} finally {rmSync(directory,{recursive:true,force:true});}

