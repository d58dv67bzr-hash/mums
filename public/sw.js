const cacheName = 'mums-shell-v1'

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(cacheName)
    const shell = await fetch('/', { cache: 'reload' })
    if (!shell.ok) throw new Error('Startsidan kunde inte hämtas.')
    const markup = await shell.clone().text()
    const assets = [...markup.matchAll(/(?:src|href)="(\/assets\/[^"]+)"/g)].map(match => match[1])
    await cache.addAll([...assets, '/mark.svg', '/icon.svg', '/apple-touch-icon.png', '/icon-192.png', '/icon-512.png',
      '/icon-maskable.png', '/manifest.webmanifest', '/exempelmeny.html'])
    await cache.put('/', shell)
  })())
})

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    await Promise.all((await caches.keys()).filter(key => key.startsWith('mums-shell-') && key !== cacheName).map(key => caches.delete(key)))
    await self.clients.claim()
  })())
})

self.addEventListener('fetch', event => {
  const { request } = event
  const url = new URL(request.url)
  if (request.method !== 'GET' || url.origin !== self.location.origin) return
  event.respondWith((async () => {
    const cache = await caches.open(cacheName)
    try {
      const response = await fetch(request)
      if (response.ok && (url.pathname.startsWith('/assets/') || url.pathname === '/')) await cache.put(request, response.clone())
      return response
    } catch {
      const cached = await cache.match(request)
      if (cached) return cached
      if (request.mode === 'navigate' && url.pathname === '/') {
        const shell = await cache.match('/')
        if (shell) return shell
      }
      return Response.error()
    }
  })())
})
