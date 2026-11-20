import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // relative Pfade: die App läuft unter jeder Adresse (z. B. https://name.github.io/reiseplaner/)
  base: './',
  server: { port: 5173 },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
