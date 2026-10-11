import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { findUp, readPackageJsonFile } from '../utils/files.js';

/**
 * What the CLI can honestly render into.
 *
 * The SDK is framework-agnostic — `render()` takes a CSS selector and a
 * layout, and touches nothing but the DOM. So the interesting axis is not
 * "which framework" but "is there a browser document to render into, and how
 * does code reach the page". That gives three families:
 *
 *   - Vite builds: modules are bundled, so `import` works and JSON imports are
 *     free. Each framework gets a thin adapter file, nothing more.
 *   - Plain static HTML: no bundler, so a bare `import '@clirevenue/sdk'`
 *     would fail to resolve in the browser. The adapter imports from a CDN
 *     and fetches the config at runtime instead.
 *   - No document at all: a Node server, a library, a CLI. `render()` cannot
 *     work there, and pretending otherwise is worse than saying so.
 */
export type ProjectType =
  | 'vite-react'
  | 'vite-vue'
  | 'vite-svelte'
  | 'vite-vanilla'
  | 'static-html'
  | 'node'
  | 'unsupported';

export type Framework = 'react' | 'vue' | 'svelte' | 'solid' | 'none';

export interface ProjectInfo {
  type: ProjectType;
  root: string;
  packageManager: 'npm' | 'pnpm' | 'yarn' | 'bun' | 'unknown';
  /** @deprecated kept for the existing suite; prefer `framework`. */
  hasReact: boolean;
  /** @deprecated kept for the existing suite; prefer `type`. */
  hasVite: boolean;
  framework: Framework;
  hasHtmlEntry: boolean;
  /** True when `render()` can actually place an ad here. */
  supportsRendering: boolean;
  /** Why `supportsRendering` is false, in words fit for a terminal. */
  reason?: string;
}

function detectPackageManager(root: string): ProjectInfo['packageManager'] {
  if (existsSync(join(root, 'pnpm-lock.yaml'))) return 'pnpm';
  if (existsSync(join(root, 'yarn.lock'))) return 'yarn';
  if (existsSync(join(root, 'bun.lockb'))) return 'bun';
  if (existsSync(join(root, 'package-lock.json'))) return 'npm';
  return 'npm';
}

const HTML_ENTRIES = ['index.html', 'src/index.html', 'public/index.html'];

function detectFramework(deps: Record<string, string>): Framework {
  if ('react' in deps || 'react-dom' in deps) return 'react';
  if ('vue' in deps) return 'vue';
  if ('svelte' in deps) return 'svelte';
  if ('solid-js' in deps) return 'solid';
  return 'none';
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

  const hasHtmlEntry = HTML_ENTRIES.some((entry) => existsSync(join(root, entry)));
  const framework = detectFramework(deps);

  const { type, supportsRendering, reason } = classify({
    hasPackageJson: Boolean(pkgPath),
    hasVite,
    hasHtmlEntry,
    framework,
  });

  return {
    type,
    root,
    packageManager: detectPackageManager(root),
    hasReact,
    hasVite,
    framework,
    hasHtmlEntry,
    supportsRendering,
    ...(reason ? { reason } : {}),
  };
}

function classify(input: {
  hasPackageJson: boolean;
  hasVite: boolean;
  hasHtmlEntry: boolean;
  framework: Framework;
}): { type: ProjectType; supportsRendering: boolean; reason?: string } {
  /* Vite first. A Vite config or dependency is the strongest signal, and it
     does not require an HTML file on disk — plenty of real projects keep
     `index.html` somewhere the detector's fixed guesses do not reach, and
     refusing those would be a false negative on a perfectly good app. */
  if (input.hasVite) {
    switch (input.framework) {
      case 'react':
        return { type: 'vite-react', supportsRendering: true };
      case 'vue':
        return { type: 'vite-vue', supportsRendering: true };
      case 'svelte':
        return { type: 'vite-svelte', supportsRendering: true };
      default:
        return { type: 'vite-vanilla', supportsRendering: true };
    }
  }

  /* Plain static HTML: a document exists and there is no bundler to route
     around it. The adapter loads the SDK from a CDN and fetches the config
     at runtime, so this works without Node, without a build, and without
     adding a single dependency to the user's project. */
  if (input.hasHtmlEntry) return { type: 'static-html', supportsRendering: true };

  /* A package.json but no page. This is a library, a server, or a CLI —
     somewhere with no document to render into. Say so plainly. */
  if (input.hasPackageJson) {
    return {
      type: 'node',
      supportsRendering: false,
      reason:
        'No HTML entry point was found, so there is no page to place an ad on. ' +
        'CLIRevenue renders ads into a browser document — run setup from the folder ' +
        'that serves your web app.',
    };
  }

  return {
    type: 'unsupported',
    supportsRendering: false,
    reason:
      'No package.json or index.html was found here or in any parent directory. ' +
      'Run setup from the root of your web app.',
  };
}

/**
 * Project types the CLI can generate a real adapter for today.
 *
 * Deliberately a closed list. Each entry names a file the CLI actually
 * writes and can therefore actually verify; anything else is reported as
 * unsupported rather than guessed at.
 */
export const SUPPORTED_TYPES: readonly ProjectType[] = [
  'vite-react',
  'vite-vue',
  'vite-svelte',
  'vite-vanilla',
  'static-html',
];

export const isSupported = (type: ProjectType): boolean => SUPPORTED_TYPES.includes(type);

/** Human-facing stack name, used in prompts and next-step text. */
export function describeProject(project: ProjectInfo): string {
  switch (project.type) {
    case 'vite-react':
      return 'Vite + React';
    case 'vite-vue':
      return 'Vite + Vue';
    case 'vite-svelte':
      return 'Vite + Svelte';
    case 'vite-vanilla':
      return 'Vite';
    case 'static-html':
      return 'Static HTML';
    case 'node':
      return 'Node.js project (no web page)';
    default:
      return 'Unrecognised project';
  }
}
