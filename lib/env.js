import fs from 'node:fs';
import path from 'node:path';
export function loadEnv(cwd=process.cwd()){
 const file=path.join(cwd,'.env');if(!fs.existsSync(file))return;
 const text=fs.readFileSync(file,'utf8');
 for(const raw of text.split(/\r?\n/)){
  const line=raw.trim();if(!line||line.startsWith('#'))continue;
  const idx=line.indexOf('=');if(idx<1)continue;
  const key=line.slice(0,idx).trim();let value=line.slice(idx+1).trim();
  if((value.startsWith('"')&&value.endsWith('"'))||(value.startsWith("'")&&value.endsWith("'")))value=value.slice(1,-1);
  if(process.env[key]===undefined)process.env[key]=value;
 }
}
