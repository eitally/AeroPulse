import { defineConfig, mergeConfig } from 'vitest/config';
import viteConfig from './vite.config.ts';

export default defineConfig((env) => {
  const baseConfig = typeof viteConfig === 'function' ? viteConfig(env) : viteConfig;
  return mergeConfig(
    baseConfig,
    defineConfig({
      test: {
        include: ['tests/**/*.test.ts'],
        exclude: ['e2e/**', 'node_modules/**', 'dist/**'],
      },
    })
  );
});
