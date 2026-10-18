import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    port: 5173,
    proxy: {
      '/.proxy/backend/socket.io': {
        target: 'http://localhost:3000',
        ws: true,
        rewrite: (path) => path.replace(/^\/\.proxy\/backend/, ''),
      },
      '/.proxy/backend/api': {
        target: 'http://localhost:3000',
        rewrite: (path) => path.replace(/^\/\.proxy\/backend/, ''),
      },
      '/socket.io': { target: 'http://localhost:3000', ws: true },
      '/api': 'http://localhost:3000',
    },
  },
  build: { target: 'es2022', sourcemap: false },
});
