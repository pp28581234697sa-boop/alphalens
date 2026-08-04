import {spawnSync} from 'node:child_process';
const files=['tests/core.test.js','tests/frontend-static.test.js','tests/release-integrity.test.js','tests/v15-features.test.js','tests/lib-runtime.test.js'];
for(let i=1;i<=5;i++){
 const r=spawnSync(process.execPath,['--test',...files],{stdio:'inherit'});
 if(r.status!==0)process.exit(r.status||1);
 console.log(`Repeat ${i}/5 passed`);
}
