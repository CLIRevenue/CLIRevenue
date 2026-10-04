import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { existsSync, readFileSync, rmSync, writeFileSync, mkdirSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';

import {
  detectPackageManager,
  getInstallCommand,
  isSdkInstalled,
  installSdk,
  InstallError,
  type InstallResult,
} from '../src/install/sdk.js';

import { CLIREVENUE_SDK_VERSION } from '../src/config.js';

class FakeChild extends EventEmitter {
  exitCode = 0;
  signal = null as NodeJS.Signals | null;
  stdout = null;
  stderr = null;
  killed = false;

  kill(_sig?: NodeJS.Signals) {
    this.killed = true;
    return true;
  }
}

describe('getInstallCommand', () => {
  it('builds correct commands for each package manager', () => {
    expect(getInstallCommand('npm', '@clirevenue/sdk@1.0.2')).toBe('npm install @clirevenue/sdk@1.0.2');
    expect(getInstallCommand('pnpm', '@clirevenue/sdk@1.0.2')).toBe('pnpm add @clirevenue/sdk@1.0.2');
    expect(getInstallCommand('yarn', '@clirevenue/sdk@1.0.2')).toBe('yarn add @clirevenue/sdk@1.0.2');
    expect(getInstallCommand('bun', '@clirevenue/sdk@1.0.2')).toBe('bun add @clirevenue/sdk@1.0.2');
  });

  it('returns undefined for unknown package manager', () => {
    expect(getInstallCommand('unknown' as any, '@clirevenue/sdk@1.0.2')).toBeUndefined();
  });
});

describe('CLIREVENUE_SDK_VERSION', () => {
  it('is pinned to 1.0.2', () => {
    expect(CLIREVENUE_SDK_VERSION).toBe('1.0.2');
  });
});

describe('detectPackageManager', () => {
  let tmp: string;

  beforeEach(() => {
    tmp = mkdtempSync(join(process.cwd(), 'tmp-pm-'));
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it('detects npm by package-lock.json', () => {
    writeFileSync(join(tmp, 'package-lock.json'), '{}');
    expect(detectPackageManager(tmp)).toBe('npm');
  });

  it('detects pnpm by pnpm-lock.yaml', () => {
    writeFileSync(join(tmp, 'pnpm-lock.yaml'), 'lockfileVersion: \'9.0\'');
    expect(detectPackageManager(tmp)).toBe('pnpm');
  });

  it('detects yarn by yarn.lock', () => {
    writeFileSync(join(tmp, 'yarn.lock'), '# yarn lockfile v1');
    expect(detectPackageManager(tmp)).toBe('yarn');
  });

  it('detects bun by bun.lockb', () => {
    writeFileSync(join(tmp, 'bun.lockb'), 'binary');
    expect(detectPackageManager(tmp)).toBe('bun');
  });

  it('defaults to npm when no lockfile present', () => {
    expect(detectPackageManager(tmp)).toBe('npm');
  });
});

describe('isSdkInstalled', () => {
  let tmp: string;
  let sdkPkgPath: string;

  beforeEach(() => {
    tmp = mkdtempSync(join(process.cwd(), 'tmp-sdk-'));
    const sdkDir = join(tmp, 'node_modules', '@clirevenue', 'sdk');
    mkdirSync(sdkDir, { recursive: true });
    sdkPkgPath = join(sdkDir, 'package.json');
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it('returns false when no node_modules/@clirevenue/sdk', () => {
    expect(isSdkInstalled(tmp)).toBe(false);
  });

  it('returns false when SDK not present in node_modules', () => {
    writeFileSync(sdkPkgPath, JSON.stringify({ name: '@clirevenue/sdk', version: '1.0.1' }, null, 2));
    expect(isSdkInstalled(tmp)).toBe(false);
  });

  it('returns true when SDK in node_modules at correct version', () => {
    writeFileSync(sdkPkgPath, JSON.stringify({ name: '@clirevenue/sdk', version: '1.0.2' }, null, 2));
    expect(isSdkInstalled(tmp)).toBe(true);
  });

  it('returns false for other versions in node_modules', () => {
    writeFileSync(sdkPkgPath, JSON.stringify({ name: '@clirevenue/sdk', version: '1.0.3' }, null, 2));
    expect(isSdkInstalled(tmp)).toBe(false);
  });
});

describe('installSdk', () => {
  let tmp: string;

  beforeEach(() => {
    tmp = mkdtempSync(join(process.cwd(), 'tmp-install-'));
    mkdirSync(tmp, { recursive: true });
    writeFileSync(
      join(tmp, 'package.json'),
      JSON.stringify({ name: 'test-app', dependencies: {} }, null, 2),
    );
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it('resolves with alreadyInstalled=true without spawning when SDK present in node_modules', async () => {
    const sdkDir = join(tmp, 'node_modules', '@clirevenue', 'sdk');
    mkdirSync(sdkDir, { recursive: true });
    writeFileSync(
      join(sdkDir, 'package.json'),
      JSON.stringify({ name: '@clirevenue/sdk', version: '1.0.2' }, null, 2),
    );

    const spawnFn = vi.fn(() => {
      throw new Error('spawn should not be called');
    });

    const res = await installSdk(tmp, '@clirevenue/sdk@1.0.2', { spawnFn });
    expect(res.alreadyInstalled).toBe(true);
    expect(res.packageManager).toBe('npm');
    expect(res.command).toBe('npm install @clirevenue/sdk@1.0.2');
    expect(spawnFn).not.toHaveBeenCalled();
  });

  it('spawns npm with correct args, stdio inherit, inherits env', async () => {
    const child = new FakeChild();
    const spawnFn = vi.fn((_cmd, _args, opts) => {
      expect(_cmd).toBe('npm');
      expect(_args).toEqual(['install', '@clirevenue/sdk@1.0.2']);
      expect(opts.cwd).toBe(tmp);
      expect(opts.stdio).toBe('inherit');
      expect(opts.shell).toBe(process.platform === 'win32');
      expect(opts.env).toBe(process.env);
      process.nextTick(() => {
        child.emit('close', 0, null);
      });
      return child as any;
    });

    const res = await installSdk(tmp, '@clirevenue/sdk@1.0.2', { spawnFn });
    expect(res.alreadyInstalled).toBe(false);
    expect(res.packageManager).toBe('npm');
    expect(res.command).toBe('npm install @clirevenue/sdk@1.0.2');
    expect(spawnFn).toHaveBeenCalledTimes(1);
  });

  it('maps spawn error to InstallError (install_spawn_failed)', async () => {
    const spawnErr = new Error('spawn ENOENT');
    const child = new FakeChild();
    const spawnFn = vi.fn(() => {
      process.nextTick(() => child.emit('error', spawnErr));
      return child as any;
    });

    await expect(
      installSdk(tmp, '@clirevenue/sdk@1.0.2', { spawnFn }),
    ).rejects.toBeInstanceOf(InstallError);

    try {
      await installSdk(tmp, '@clirevenue/sdk@1.0.2', { spawnFn });
    } catch (e) {
      const err = e as InstallError;
      expect(err.code).toBe('install_spawn_failed');
      expect(err.message).toContain('Could not run');
    }
  });

  it('maps non-zero exit to InstallError (install_failed)', async () => {
    const child = new FakeChild();
    const spawnFn = vi.fn(() => {
      process.nextTick(() => {
        child.emit('close', 1, null);
      });
      return child as any;
    });

    await expect(
      installSdk(tmp, '@clirevenue/sdk@1.0.2', { spawnFn }),
    ).rejects.toBeInstanceOf(InstallError);

    try {
      await installSdk(tmp, '@clirevenue/sdk@1.0.2', { spawnFn });
    } catch (e) {
      const err = e as InstallError;
      expect(err.code).toBe('install_failed');
      expect(err.message).toContain('exited with code 1');
    }
  });

  it('maps signal termination to InstallError (install_failed)', async () => {
    const child = new FakeChild();
    const spawnFn = vi.fn(() => {
      process.nextTick(() => {
        child.emit('close', null, 'SIGTERM' as NodeJS.Signals);
      });
      return child as any;
    });

    try {
      await installSdk(tmp, '@clirevenue/sdk@1.0.2', { spawnFn });
      expect.unreachable('should have thrown');
    } catch (e) {
      const err = e as InstallError;
      expect(err).toBeInstanceOf(InstallError);
      expect(err.code).toBe('install_failed');
      expect(err.message).toContain('terminated by SIGTERM');
    }
  });

  it('uses shell=true on win32, false otherwise', async () => {
    const child = new FakeChild();
    const isWin = process.platform === 'win32';
    const spawnFn = vi.fn((_cmd, _args, opts) => {
      expect(opts.shell).toBe(isWin);
      process.nextTick(() => child.emit('close', 0, null));
      return child as any;
    });

    const res = await installSdk(tmp, '@clirevenue/sdk@1.0.2', { spawnFn });
    expect(res.alreadyInstalled).toBe(false);
  });

  it('defaults to @clirevenue/sdk@1.0.2 when packageName omitted', async () => {
    const child = new FakeChild();
    const spawnFn = vi.fn((_cmd, _args) => {
      expect(_args).toEqual(['install', '@clirevenue/sdk@1.0.2']);
      process.nextTick(() => child.emit('close', 0, null));
      return child as any;
    });

    const res = await installSdk(tmp, undefined, { spawnFn });
    expect(res.packageManager).toBe('npm');
    expect(res.command).toBe('npm install @clirevenue/sdk@1.0.2');
  });
});