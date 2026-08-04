import http from 'node:http';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { URL } from 'node:url';

const MIME={
 '.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.mjs':'text/javascript; charset=utf-8',
 '.css':'text/css; charset=utf-8','.json':'application/json; charset=utf-8','.webmanifest':'application/manifest+json; charset=utf-8',
 '.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.svg':'image/svg+xml','.ico':'image/x-icon','.txt':'text/plain; charset=utf-8'
};

function compileRoute(pattern){
 const names=[];
 const escaped=String(pattern).split('/').map(part=>{
  if(part.startsWith(':')){names.push(part.slice(1));return '([^/]+)'}
  return part.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
 }).join('/');
 return {regex:new RegExp(`^${escaped}/?$`),names};
}
function enhanceResponse(res){
 res.status=function(code){res.statusCode=code;return res};
 res.json=function(value){if(res.writableEnded)return res;const body=JSON.stringify(value);res.setHeader('Content-Type','application/json; charset=utf-8');res.setHeader('Content-Length',Buffer.byteLength(body));res.end(body);return res};
 res.send=function(value){if(res.writableEnded)return res;if(Buffer.isBuffer(value)){res.end(value);return res}if(typeof value==='object'&&value!==null)return res.json(value);const body=String(value??'');if(!res.hasHeader('Content-Type'))res.setHeader('Content-Type','text/plain; charset=utf-8');res.setHeader('Content-Length',Buffer.byteLength(body));res.end(body);return res};
 res.sendStatus=function(code){res.statusCode=code;res.end(http.STATUS_CODES[code]||String(code));return res};
 res.sendFile=async function(filename){try{const stat=await fsp.stat(filename);if(!stat.isFile())return res.status(404).end();res.setHeader('Content-Type',MIME[path.extname(filename).toLowerCase()]||'application/octet-stream');res.setHeader('Content-Length',stat.size);fs.createReadStream(filename).on('error',()=>{if(!res.headersSent)res.statusCode=500;res.end()}).pipe(res)}catch{res.status(404).end()}return res};
 return res;
}
function parseBody(req,limitBytes){return new Promise((resolve,reject)=>{
 let size=0;const chunks=[];
 req.on('data',chunk=>{size+=chunk.length;if(size>limitBytes){reject(Object.assign(new Error('Request body too large'),{statusCode:413}));req.destroy();return}chunks.push(chunk)});
 req.on('end',()=>{const raw=Buffer.concat(chunks).toString('utf8');if(!raw)return resolve(undefined);try{resolve(JSON.parse(raw))}catch{reject(Object.assign(new Error('Invalid JSON body'),{statusCode:400}))}});
 req.on('error',reject);
})}

export default function express(){
 const layers=[];
 const app={
  disable(){return app},
  use(...args){let mount='/',fn;if(typeof args[0]==='string'){mount=args[0];fn=args[1]}else fn=args[0];layers.push({kind:'middleware',mount,fn,error:fn?.length===4});return app},
  get(route,...handlers){addRoute('GET',route,handlers);return app},
  post(route,...handlers){addRoute('POST',route,handlers);return app},
  delete(route,...handlers){addRoute('DELETE',route,handlers);return app},
  put(route,...handlers){addRoute('PUT',route,handlers);return app},
  patch(route,...handlers){addRoute('PATCH',route,handlers);return app},
  listen(port,host,callback){const server=http.createServer(handle);return server.listen(port,host,callback)}
 };
 function addRoute(method,route,handlers){const compiled=compileRoute(route);layers.push({kind:'route',method,route,...compiled,handlers})}
 async function handle(rawReq,rawRes){
  const req=rawReq,res=enhanceResponse(rawRes);const url=new URL(req.url,'http://localhost');req.path=url.pathname;req.query=Object.fromEntries(url.searchParams.entries());req.params={};req.body=req.body??{};let index=0;
  const next=async(error)=>{
   if(res.writableEnded)return;
   while(index<layers.length){const layer=layers[index++];
    try{
     if(layer.kind==='middleware'){
      if(!req.path.startsWith(layer.mount))continue;
      if(Boolean(error)!==Boolean(layer.error))continue;
      let called=false;const localNext=e=>{called=true;return next(e)};
      const result=layer.error?layer.fn(error,req,res,localNext):layer.fn(req,res,localNext);
      if(result&&typeof result.then==='function')await result;
      if(called||res.writableEnded)return;
      return;
     }
     if(error)continue;
     if(layer.method!==req.method)continue;
     const match=req.path.match(layer.regex);if(!match)continue;
     req.params={};layer.names.forEach((name,i)=>req.params[name]=decodeURIComponent(match[i+1]));
     let hIndex=0;const runHandler=async(err)=>{
      if(err)return next(err);if(res.writableEnded)return;
      const handler=layer.handlers[hIndex++];if(!handler)return;
      let called=false;const localNext=e=>{called=true;return runHandler(e)};
      try{const result=handler(req,res,localNext);if(result&&typeof result.then==='function')await result;if(called||res.writableEnded)return;return}catch(e){await next(e)}
     };
     await runHandler();return;
    }catch(e){error=e;continue}
   }
   if(error&&!res.writableEnded){res.status(error.statusCode||500).json({error:String(error.message||error)})}
   else if(!res.writableEnded)res.status(404).json({error:'Not Found'});
  };
  await next();
 }
 return app;
}

express.json=function json(options={}){const limitText=String(options.limit||'1mb').toLowerCase();const unit=limitText.endsWith('mb')?1024*1024:limitText.endsWith('kb')?1024:1;const n=parseFloat(limitText)||1;const limit=Math.max(1024,Math.round(n*unit));return async(req,res,next)=>{if(!['POST','PUT','PATCH','DELETE'].includes(req.method))return next();const type=String(req.headers['content-type']||'');if(!type.includes('application/json'))return next();try{req.body=await parseBody(req,limit);return next()}catch(e){return next(e)}}};
express.static=function staticMiddleware(root,options={}){const base=path.resolve(root);return async(req,res,next)=>{if(!['GET','HEAD'].includes(req.method))return next();let pathname;try{pathname=decodeURIComponent(req.path)}catch{return next()}if(pathname==='/'||pathname.startsWith('/api/')||pathname.startsWith('/events/'))return next();const target=path.resolve(base,`.${pathname}`);if(!target.startsWith(base+path.sep))return next();try{const stat=await fsp.stat(target);if(!stat.isFile())return next();options.setHeaders?.(res,target,stat);res.setHeader('Content-Type',MIME[path.extname(target).toLowerCase()]||'application/octet-stream');res.setHeader('Content-Length',stat.size);if(req.method==='HEAD')return res.end();fs.createReadStream(target).on('error',next).pipe(res)}catch{return next()}}};
