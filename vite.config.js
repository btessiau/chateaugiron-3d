import { defineConfig } from 'vite';

// Relative base so the build works both locally and when hosted in a subfolder
// (for example a GitHub Pages project site).
export default defineConfig({
  base: './',
  server: { host: true },
});
