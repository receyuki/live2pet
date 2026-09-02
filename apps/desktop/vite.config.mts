import path from 'node:path';
import { fileURLToPath } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

const desktopRoot = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root: path.join(desktopRoot, 'ui'),
  base: './',
  plugins: [tailwindcss(), react()],
  build: {
    outDir: path.join(desktopRoot, 'renderer-dist'),
    emptyOutDir: true,
  },
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.{ts,tsx}'],
    setupFiles: ['./src/test-setup.ts'],
    css: true,
  },
});
