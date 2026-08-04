const CACHE='alphalens-v15.1-shell';
const SHELL=['/','/index.html','/styles.css?v=15.1.0','/app.js?v=15.1.0','/core.js','/manifest.webmanifest?v=15.1.0'];
self.addEventListener('install',event=>event.waitUntil(caches.open(CACHE).then(c=>c.addAll(SHELL)).then(()=>self.skipWaiting())));
self.addEventListener('activate',event=>event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim())));
self.addEventListener('fetch',event=>{
 const req=event.request,url=new URL(req.url);
 if(req.method!=='GET'||url.pathname.startsWith('/api/'))return;
 if(req.mode==='navigate')return event.respondWith(fetch(req).then(res=>{const copy=res.clone();caches.open(CACHE).then(c=>c.put('/index.html',copy));return res}).catch(()=>caches.match('/index.html')));
 event.respondWith(caches.match(req).then(cached=>cached||fetch(req).then(res=>{if(res.ok&&url.origin===location.origin){const copy=res.clone();caches.open(CACHE).then(c=>c.put(req,copy))}return res})));
});
self.addEventListener('notificationclick',event=>{
 event.notification.close();
 event.waitUntil(clients.matchAll({type:'window',includeUncontrolled:true}).then(rows=>{const existing=rows[0];if(existing){existing.focus();return existing.navigate(event.notification.data?.url||'/')}return clients.openWindow(event.notification.data?.url||'/')}));
});
