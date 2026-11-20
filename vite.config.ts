import { defineConfig, loadEnv, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

// Hosty tuneli HTTPS używanych do testów PWA na telefonie (patrz README).
const tunnelHosts = ['.trycloudflare.com', '.loca.lt', '.ngrok-free.app'];

/**
 * version.json w buildzie: gra porównuje swoją wersję z wersją na serwerze z pominięciem buforów
 * (iPhone potrafi długo trzymać stare pliki aplikacji z ekranu głównego). Plik nie trafia do bufora offline.
 */
function versionFile(env: Record<string, string>): Plugin {
  return {
    name: 'szlaki-version-file',
    apply: 'build',
    generateBundle() {
      const version = (env.VITE_APP_VERSION ?? '').trim().slice(0, 7) || 'dev';
      const builtAt = (env.VITE_BUILD_TIME ?? '').trim();
      this.emitFile({ type: 'asset', fileName: 'version.json', source: JSON.stringify({ version, builtAt }) });
    },
  };
}

export default defineConfig(({ mode }) => ({
  plugins: [
    react(),
    versionFile(loadEnv(mode, '.', 'VITE_')),
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: false, // rejestrujemy ręcznie w src/main.tsx
      includeAssets: ['favicon.svg', 'icons/apple-touch-icon.png'],
      manifest: {
        name: 'Szlaki Dziczy',
        short_name: 'Szlaki',
        description: 'Prototyp RPG o kolekcjonowaniu stworzeń (niekomercyjny).',
        lang: 'pl',
        start_url: '.',
        scope: '.',
        display: 'standalone',
        orientation: 'any',
        background_color: '#0f1a17',
        theme_color: '#0f1a17',
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,webmanifest}'],
        // Phaser w osobnym chunku ma ~1,2 MB — podnosimy domyślny limit 2 MiB z zapasem.
        maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
        navigateFallback: 'index.html',
        runtimeCaching: [
          {
            // Sprite'y z repozytorium PokeAPI/sprites: buforujemy na stałe (działają offline).
            urlPattern: /^https:\/\/raw\.githubusercontent\.com\/PokeAPI\/sprites\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'pokeapi-sprites',
              expiration: { maxEntries: 2000, maxAgeSeconds: 60 * 60 * 24 * 90 },
              // Tylko pełne odpowiedzi CORS (status 200): odpowiedź „opaque” (0) nie nadaje się na teksturę WebGL.
              cacheableResponse: { statuses: [200] },
            },
          },
          // JSON z PokéAPI NIE jest tu buforowany — robi to Dexie (zwięzłe, znormalizowane rekordy).
        ],
      },
      devOptions: { enabled: false },
    }),
  ],
  server: { host: true, port: 5173, allowedHosts: tunnelHosts },
  preview: { host: true, port: 4173, allowedHosts: tunnelHosts },
  build: {
    target: 'es2020',
    chunkSizeWarningLimit: 1600,
    rollupOptions: {
      output: {
        manualChunks: {
          phaser: ['phaser'],
          react: ['react', 'react-dom'],
        },
      },
    },
  },
}));
