import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { join } from 'node:path';
import { unfurlPlugin } from './server/unfurl.ts';
import { createSyncServer } from './server/sync.ts';

/** Real-time sync on /sync while developing (same server as `npm run serve`). */
function syncPlugin(): Plugin {
  return {
    name: 'heist-sync',
    configureServer(server) {
      const sync = createSyncServer({ dataFile: join(import.meta.dirname, 'data', 'server-db.json') });
      server.httpServer?.on('upgrade', (req, socket, head) => { sync.handleUpgrade(req, socket, head); });
    },
  };
}

export default defineConfig({
  plugins: [react(), unfurlPlugin(), syncPlugin()],
  server: { port: 5173 },
});
