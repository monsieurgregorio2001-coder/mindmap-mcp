import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const apiPort = Number(process.env.PORT ?? 4317);

export default defineConfig({
  root: 'src/web',
  plugins: [react()],
  build: { outDir: '../../dist', emptyOutDir: true },
  server: { port: 5173, proxy: { '/api': `http://127.0.0.1:${apiPort}` } },
});
