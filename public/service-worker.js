const CACHE='stockly-static-v9';
const ASSETS=['/','/styles.css','/app.js','/manifest.webmanifest','/icon.svg'];
self.addEventListener('install',event=>event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(ASSETS)).then(()=>self.skipWaiting())));
self.addEventListener('activate',event=>event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(key=>key!==CACHE).map(key=>caches.delete(key)))).then(()=>self.clients.claim())));
self.addEventListener('fetch',event=>{
  const url=new URL(event.request.url);
  if(event.request.method!=='GET'||url.origin!==self.location.origin||url.pathname.startsWith('/api/'))return;
  if(url.pathname==='/'||ASSETS.includes(url.pathname)){
    event.respondWith(fetch(event.request).then(response=>{
      if(response.ok){const copy=response.clone();caches.open(CACHE).then(cache=>cache.put(event.request,copy))}
      return response;
    }).catch(()=>caches.match(event.request)));
  }
});
self.addEventListener('push',event=>{let data={title:'Stockly',body:'Ada pembaruan inventaris.'};try{if(event.data)data={...data,...event.data.json()}}catch{}event.waitUntil(self.registration.showNotification(data.title,{body:data.body,icon:'/icon.svg',badge:'/icon.svg',data:{url:data.url||'/'},tag:'stokly-'+(data.title||'update')}))});
self.addEventListener('notificationclick',event=>{event.notification.close();const target=new URL(event.notification.data?.url||'/',self.location.origin).href;event.waitUntil(self.clients.matchAll({type:'window',includeUncontrolled:true}).then(clients=>{const existing=clients.find(client=>client.url.startsWith(self.location.origin));if(existing){existing.navigate(target);return existing.focus()}return self.clients.openWindow(target)}))});
