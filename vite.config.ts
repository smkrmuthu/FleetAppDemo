import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  base: './',
  plugins: [react()],
  server: {
    port: Number(process.env.PORT) || 5180,
    host: true
  },
  // The worker has its own tests (worker/), run from there.
  test: {
    include: ['src/**/*.test.ts']
  }
});
