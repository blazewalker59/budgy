/*
  Budgy service worker, as sportsline's: it makes Budgy an installable app
  and takes control at once. It caches nothing (the budget is always read
  live) and is where notifications would land if Budgy ever pushes them.
*/

self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()))

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const url = new URL(event.notification.data?.url || '/', self.location.origin).href
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windows) => {
      const open = windows.find((w) => new URL(w.url).origin === self.location.origin)
      if (open) return open.focus().then(() => open.navigate(url))
      return self.clients.openWindow(url)
    }),
  )
})
