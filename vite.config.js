import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// React app with JSX precompiled at build time (no in-browser Babel).
// `npm run dev` for an HMR dev server, `npm run build` to emit static dist/.
// base: deployed to GitHub Pages as a project site at
// https://<user>.github.io/labels/, so production assets (and the BASE_URL the
// ISO symbol loader relies on) must resolve under /labels/. Dev stays at / for
// convenience.
export default defineConfig(({ command }) => ({
  base: command === 'build' ? '/labels/' : '/',
  plugins: [react()],
}));
