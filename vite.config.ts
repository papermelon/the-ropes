import { defineConfig } from 'vite';
export default defineConfig({ server: { port: 5184, strictPort: true, watch: { ignored: ['**/playwright-report/**', '**/test-results/**', '**/tmp/**', '**/docs/**'] }, proxy: { '/api': { target: 'http://127.0.0.1:8787', ws: true } } } });
