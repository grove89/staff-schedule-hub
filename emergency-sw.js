/* Staff Schedule Hub — emergency push service worker. */
self.addEventListener('push',event=>{
 let data={};try{data=event.data?event.data.json():{}}catch{data={body:event.data?.text()||''}}
 const title=typeof data.title==='string'?data.title:'🚨 Emergency coverage needed';
 const body=typeof data.body==='string'?data.body:(typeof data.message==='string'?data.message:'Open Staff Schedule Hub for details.');
 const url=typeof data.url==='string'&&data.url.startsWith('https://')?data.url:self.registration.scope;
 event.waitUntil(self.registration.showNotification(title,{body,tag:'staff-hub-emergency',renotify:true,requireInteraction:true,data:{url}}));
});
self.addEventListener('notificationclick',event=>{
 event.notification.close();const url=event.notification.data?.url||self.registration.scope;
 event.waitUntil(clients.matchAll({type:'window',includeUncontrolled:true}).then(async windows=>{
  for(const w of windows){if(w.url.startsWith(self.registration.scope)){await w.focus();return;}}
  return clients.openWindow(url);
 }));
});
