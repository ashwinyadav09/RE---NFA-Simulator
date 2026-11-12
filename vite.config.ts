import { execSync } from 'node:child_process';
import { defineConfig } from 'vitest/config';
import { viteSingleFile } from 'vite-plugin-singlefile';

function getGitCommit(): string {
  try {
    const hash = execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
    if (!hash) return 'unknown';
    const status = execSync('git status --porcelain', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
    return status ? `${hash}-dirty` : hash;
  } catch {
    return 'unknown';
  }
}

export default defineConfig({
  plugins: [viteSingleFile()],
  define: {
    __BUILD_COMMIT__: JSON.stringify(getGitCommit())
  },
  build: {
    target: 'es2022'
  },
  test: {
    include: ['tests/**/*.test.ts']
  }
});



