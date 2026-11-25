import { readFile } from 'node:fs/promises'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'

// Frivillig, lokal utvecklingsvisning. Produktionsbygget läser aldrig filen.
function privateMenuFeed(): Plugin {
  const file = new URL('./.mums/scan.json', import.meta.url)
  async function feed(req: IncomingMessage, res: ServerResponse, next: () => void) {
    if (req.url?.split('?')[0] !== '/menydata.json') return next()
    const loopback = /^(127\.0\.0\.1|\[::1\]|localhost)(:\d+)?$/iu.test(req.headers.host ?? '') &&
      ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress ?? '')
    if (process.env.MUMS_LOCAL_DATA !== '1' || !loopback || req.method !== 'GET') return next()
    if ((req.headers['sec-fetch-site'] && !['same-origin', 'none'].includes(req.headers['sec-fetch-site'])) ||
      (req.headers.origin && req.headers.origin !== 'http://' + req.headers.host)) {
      res.statusCode = 403
      res.end()
      return
    }
    try {
      const { feed } = JSON.parse(await readFile(file, 'utf8'))
      if (!feed) throw new Error()
      res.setHeader('Content-Type', 'application/json; charset=utf-8')
      res.setHeader('Cache-Control', 'private, no-store')
      res.end(JSON.stringify(feed))
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return next()
      res.statusCode = 500
      res.end()
    }
  }
  return {
    name: 'mums-private-menu-feed',
    configureServer(server) { server.middlewares.use((req, res, next) => void feed(req, res, next)) },
    configurePreviewServer(server) { server.middlewares.use((req, res, next) => void feed(req, res, next)) },
  }
}

export default defineConfig({
  plugins: [react(), privateMenuFeed()],
  server: { fs: { deny: ['**/.env', '**/.env.*', '**/*.{crt,pem}', '**/.git/**', '**/.mums/**'] } },
})
