/* Authenticated pages and APIs deliberately remain network-only. */
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));
self.addEventListener('fetch', (event) => {
  if (event.request.mode === 'navigate') event.respondWith(fetch(event.request).catch(() => new Response('<!doctype html><html lang="he" dir="rtl"><meta name="viewport" content="width=device-width,initial-scale=1"><meta charset="utf-8"><title>משמרת — אין חיבור</title><body style="font-family:Arial;background:#f6f8fa;color:#17353c;padding:12vh 8vw"><h1>נחזור כשיהיה חיבור</h1><p>לוח המשמרות מתעדכן בזמן אמת ודורש חיבור לאינטרנט.</p><button onclick="location.reload()" style="padding:12px 24px">ניסיון נוסף</button></body></html>', {headers:{'Content-Type':'text/html;charset=utf-8'}})));
});
