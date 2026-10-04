import { existsSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { findUp, readPackageJsonFile } from '../utils/files.js';

export type ProjectType = 'vite-react' | 'unsupported';

export interface ProjectInfo {
  type: ProjectType;
  root: string;
  packageManager: 'npm' | 'pnpm' | 'yarn' | 'bun' | 'unknown';
  hasReact: boolean;
  hasVite: boolean;
}

function detectPackageManager(root: string): ProjectInfo['packageManager'] {
  if (existsSync(join(root, 'pnpm-lock.yaml'))) return 'pnpm';
  if (existsSync(join(root, 'yarn.lock'))) return 'yarn';
  if (existsSync(join(root, 'bun.lockb'))) return 'bun';
  if (existsSync(join(root, 'package-lock.json'))) return 'npm';
  return 'npm';
}

export function detectProject(cwd: string): ProjectInfo {
  /* One resolution, used for everything.
     The previous version resolved `root` from `findUp('package.json', cwd)`
     but read dependencies from `readPackageJson(cwd)` — which does its own
     `findUp`. Run `setup` from a nested folder and the two could land on
     different package.json files: the root became the inner package while
     the dependencies came from the outer one, so a perfectly good Vite +
     React project was reported as `unsupported`. Both now come from the
     same file. */
  const pkgPath = findUp('package.json', cwd);
  const root = pkgPath ? dirname(pkgPath) : cwd;

  const pkg = pkgPath ? readPackageJsonFile(pkgPath) : null;
  const deps = {
    ...((pkg?.dependencies as Record<string, string>) || {}),
    ...((pkg?.devDependencies as Record<string, string>) || {}),
  };

  const hasReact = 'react' in deps || 'react-dom' in deps;
  const hasVite =
    'vite' in deps ||
    existsSync(join(root, 'vite.config.ts')) ||
    existsSync(join(root, 'vite.config.js')) ||
    existsSync(join(root, 'vite.config.mts')) ||
    existsSync(join(root, 'vite.config.mjs'));

  const type: ProjectType = hasReact && hasVite ? 'vite-react' : 'unsupported';

  return {
    type,
    root,
    packageManager: detectPackageManager(root),
    hasReact,
    hasVite,
  };
}
