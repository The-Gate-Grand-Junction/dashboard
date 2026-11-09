import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import tailwindcss from '@tailwindcss/vite';
import { sentryVitePlugin } from '@sentry/vite-plugin';
import { fileURLToPath, URL } from 'node:url';

// Source maps go to Sentry only when SENTRY_AUTH_TOKEN is set on the build:
// 'hidden' maps leave no sourceMappingURL in the JS, and the plugin deletes
// them from dist after upload, so they are never served publicly.
const sentryUpload = !!process.env.SENTRY_AUTH_TOKEN;

export default defineConfig({
  plugins: [
    vue(),
    tailwindcss(),
    sentryVitePlugin({
      org: process.env.SENTRY_ORG,
      project: process.env.SENTRY_PROJECT,
      authToken: process.env.SENTRY_AUTH_TOKEN,
      disable: !sentryUpload,
      telemetry: false,
      sourcemaps: { filesToDeleteAfterUpload: ['./dist/**/*.js.map'] },
    }),
  ],
  build: { sourcemap: sentryUpload ? 'hidden' : false },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
});
