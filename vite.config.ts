import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// Static build — output is a plain folder of files, deployable anywhere.
export default defineConfig({
  plugins: [react()],
  base: './',
  build: { outDir: 'dist' },
  test: {
    // The sim is pure and has no DOM, so the node environment is all it needs.
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
