import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs';
import { join, basename, dirname } from 'node:path';

export function fileExists(path: string): boolean {
  return existsSync(path);
}

export function readFile(path: string): string {
  return readFileSync(path, 'utf8');
}

export function writeFile(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content, 'utf8');
}

export function appendFile(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content, { flag: 'a' });
}

export function listFiles(dir: string, pattern?: string): string[] {
  if (!existsSync(dir)) return [];
  const entries = readdirSync(dir, { withFileTypes: true });
  const files = entries
    .filter((e) => e.isFile())
    .map((e) => join(dir, e.name));
  if (pattern) {
    const regex = new RegExp(pattern.replace(/\*/g, '.*'));
    return files.filter((f) => regex.test(basename(f)));
  }
  return files;
}

export function findUp(filename: string, startDir: string): string | null {
  let dir = startDir;
  while (true) {
    const candidate = join(dir, filename);
    if (existsSync(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

export function hasPackageJson(startDir: string): string | null {
  return findUp('package.json', startDir);
}

/**
 * Reads a package.json from an already-resolved path.
 *
 * Prefer this over `readPackageJson` when the path has already been found
 * with `findUp`, so a project is never described by two separate lookups
 * that can resolve to different files.
 */
export function readPackageJsonFile(pkgPath: string): Record<string, unknown> | null {
  try {
    return JSON.parse(readFile(pkgPath));
  } catch {
    return null;
  }
}

export function readPackageJson(startDir: string): Record<string, unknown> | null {
  const pkgPath = hasPackageJson(startDir);
  if (!pkgPath) return null;
  return readPackageJsonFile(pkgPath);
}
