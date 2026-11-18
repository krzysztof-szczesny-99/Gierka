import { defineConfig } from 'vitest/config';

// Osobna konfiguracja testów (bez wtyczek PWA/React) — testujemy czysty silnik gry.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
