import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { join } from 'node:path';
import { unfurlPlugin } from './server/unfurl.ts';
import { createSyncServer } from './server/sync.ts';
import { createUploads } from './server/uploads.ts';
import { createDerive } from './server/derive.ts';

/** Real-time sync (/sync) and media uploads while developing (same as `npm run serve`). */
function syncPlugin(): Plugin {
  return {
    name: 'heist-sync',
    configureServer(server) {
      const data = join(import.meta.dirname, 'data');
      const sync = createSyncServer({ dataFile: join(data, 'server-db.json') });
      server.httpServer?.on('upgrade', (req, socket, head) => { sync.handleUpgrade(req, socket, head); });
      const uploads = createUploads(join(data, 'uploads'));
      server.middlewares.use('/api/upload', uploads.upload);
      server.middlewares.use('/uploads', uploads.serve);
      server.middlewares.use('/api/derive', createDerive(join(data, 'uploads')).handle);
    },
  };
}

export default defineConfig({
  plugins: [react(), unfurlPlugin(), syncPlugin()],
  server: { port: 5173 },
});
