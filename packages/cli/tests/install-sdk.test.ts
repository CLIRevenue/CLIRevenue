import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { existsSync, readFileSync, rmSync, writeFileSync, mkdirSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';

import {
  detectPackageManager,
  getInstallCommand,
  isSdkInstalled,
  installSdk,
  compareVersions,
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
    expect(getInstallCommand('npm', `@clirevenue/sdk@${CLIREVENUE_SDK_VERSION}`)).toBe(`npm install @clirevenue/sdk@${CLIREVENUE_SDK_VERSION}`);
    expect(getInstallCommand('pnpm', `@clirevenue/sdk@${CLIREVENUE_SDK_VERSION}`)).toBe(`pnpm add @clirevenue/sdk@${CLIREVENUE_SDK_VERSION}`);
    expect(getInstallCommand('yarn', `@clirevenue/sdk@${CLIREVENUE_SDK_VERSION}`)).toBe(`yarn add @clirevenue/sdk@${CLIREVENUE_SDK_VERSION}`);
    expect(getInstallCommand('bun', `@clirevenue/sdk@${CLIREVENUE_SDK_VERSION}`)).toBe(`bun add @clirevenue/sdk@${CLIREVENUE_SDK_VERSION}`);
  });

  it('returns undefined for unknown package manager', () => {
    expect(getInstallCommand('unknown' as any, `@clirevenue/sdk@${CLIREVENUE_SDK_VERSION}`)).toBeUndefined();
  });
});

describe('CLIREVENUE_SDK_VERSION', () => {
  it('is pinned to 2.1.0', () => {
    expect(CLIREVENUE_SDK_VERSION).toBe('2.1.0');
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

describe('compareVersions', () => {
  it('orders releases by major, then minor, then patch', () => {
    expect(compareVersions('2.1.0', '2.1.0')).toBe(0);
    expect(compareVersions('2.2.0', '2.1.0')).toBeGreaterThan(0);
    expect(compareVersions('2.1.0', '2.2.0')).toBeLessThan(0);
    expect(compareVersions('3.0.0', '2.9.9')).toBeGreaterThan(0);
    expect(compareVersions('2.1.1', '2.1.0')).toBeGreaterThan(0);
  });

  it('tolerates a v prefix and surrounding whitespace', () => {
    expect(compareVersions(' v2.1.0 ', '2.1.0')).toBe(0);
  });

  it('sorts a pre-release below the plain release', () => {
    expect(compareVersions('2.1.0-rc.1', '2.1.0')).toBeLessThan(0);
    expect(compareVersions('2.1.0', '2.1.0-rc.1')).toBeGreaterThan(0);
  });

  it('returns NaN for an unparseable version', () => {
    expect(compareVersions('latest', '2.1.0')).toBeNaN();
    expect(compareVersions('2.1', '2.1.0')).toBeNaN();
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
    writeFileSync(sdkPkgPath, JSON.stringify({ name: '@clirevenue/sdk', version: CLIREVENUE_SDK_VERSION }, null, 2));
    expect(isSdkInstalled(tmp)).toBe(true);
  });

  it('returns false for other versions in node_modules', () => {
    writeFileSync(sdkPkgPath, JSON.stringify({ name: '@clirevenue/sdk', version: '1.0.3' }, null, 2));
    expect(isSdkInstalled(tmp)).toBe(false);
  });

  it('returns true for a newer SDK, so setup does not downgrade it', () => {
    writeFileSync(sdkPkgPath, JSON.stringify({ name: '@clirevenue/sdk', version: '2.99.0' }, null, 2));
    expect(isSdkInstalled(tmp)).toBe(true);
  });

  it('returns false for a pre-release of the required version', () => {
    writeFileSync(sdkPkgPath, JSON.stringify({ name: '@clirevenue/sdk', version: `${CLIREVENUE_SDK_VERSION}-rc.1` }, null, 2));
    expect(isSdkInstalled(tmp)).toBe(false);
  });

  it('returns false when package.json has no version', () => {
    writeFileSync(sdkPkgPath, JSON.stringify({ name: '@clirevenue/sdk' }, null, 2));
    expect(isSdkInstalled(tmp)).toBe(false);
  });

  it('honours an explicit requiredVersion', () => {
    writeFileSync(sdkPkgPath, JSON.stringify({ name: '@clirevenue/sdk', version: '2.1.0' }, null, 2));
    expect(isSdkInstalled(tmp, '2.1.0')).toBe(true);
    expect(isSdkInstalled(tmp, '2.2.0')).toBe(false);
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
      JSON.stringify({ name: '@clirevenue/sdk', version: CLIREVENUE_SDK_VERSION }, null, 2),
    );

    const spawnFn = vi.fn(() => {
      throw new Error('spawn should not be called');
    });

    const res = await installSdk(tmp, `@clirevenue/sdk@${CLIREVENUE_SDK_VERSION}`, { spawnFn });
    expect(res.alreadyInstalled).toBe(true);
    expect(res.packageManager).toBe('npm');
    expect(res.command).toBe(`npm install @clirevenue/sdk@${CLIREVENUE_SDK_VERSION}`);
    expect(spawnFn).not.toHaveBeenCalled();
  });

  it('does not spawn when a newer SDK is already installed', async () => {
    const sdkDir = join(tmp, 'node_modules', '@clirevenue', 'sdk');
    mkdirSync(sdkDir, { recursive: true });
    writeFileSync(
      join(sdkDir, 'package.json'),
      JSON.stringify({ name: '@clirevenue/sdk', version: '99.0.0' }, null, 2),
    );

    const spawnFn = vi.fn(() => {
      throw new Error('spawn should not be called');
    });

    const res = await installSdk(tmp, `@clirevenue/sdk@${CLIREVENUE_SDK_VERSION}`, { spawnFn });
    expect(res.alreadyInstalled).toBe(true);
    expect(spawnFn).not.toHaveBeenCalled();
  });

  it('spawns npm with correct args, stdio inherit, inherits env', async () => {
    const child = new FakeChild();
    const spawnFn = vi.fn((_cmd, _args, opts) => {
      expect(_cmd).toBe('npm');
      expect(_args).toEqual(['install', `@clirevenue/sdk@${CLIREVENUE_SDK_VERSION}`]);
      expect(opts.cwd).toBe(tmp);
      expect(opts.stdio).toBe('inherit');
      expect(opts.shell).toBe(process.platform === 'win32');
      expect(opts.env).toBe(process.env);
      process.nextTick(() => {
        child.emit('close', 0, null);
      });
      return child as any;
    });

    const res = await installSdk(tmp, `@clirevenue/sdk@${CLIREVENUE_SDK_VERSION}`, { spawnFn });
    expect(res.alreadyInstalled).toBe(false);
    expect(res.packageManager).toBe('npm');
    expect(res.command).toBe(`npm install @clirevenue/sdk@${CLIREVENUE_SDK_VERSION}`);
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
      installSdk(tmp, `@clirevenue/sdk@${CLIREVENUE_SDK_VERSION}`, { spawnFn }),
    ).rejects.toBeInstanceOf(InstallError);

    try {
      await installSdk(tmp, `@clirevenue/sdk@${CLIREVENUE_SDK_VERSION}`, { spawnFn });
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
      installSdk(tmp, `@clirevenue/sdk@${CLIREVENUE_SDK_VERSION}`, { spawnFn }),
    ).rejects.toBeInstanceOf(InstallError);

    try {
      await installSdk(tmp, `@clirevenue/sdk@${CLIREVENUE_SDK_VERSION}`, { spawnFn });
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
      await installSdk(tmp, `@clirevenue/sdk@${CLIREVENUE_SDK_VERSION}`, { spawnFn });
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

    const res = await installSdk(tmp, `@clirevenue/sdk@${CLIREVENUE_SDK_VERSION}`, { spawnFn });
    expect(res.alreadyInstalled).toBe(false);
  });

  it('defaults to the pinned @clirevenue/sdk version when packageName omitted', async () => {
    const child = new FakeChild();
    const spawnFn = vi.fn((_cmd, _args) => {
      expect(_args).toEqual(['install', `@clirevenue/sdk@${CLIREVENUE_SDK_VERSION}`]);
      process.nextTick(() => child.emit('close', 0, null));
      return child as any;
    });

    const res = await installSdk(tmp, undefined, { spawnFn });
    expect(res.packageManager).toBe('npm');
    expect(res.command).toBe(`npm install @clirevenue/sdk@${CLIREVENUE_SDK_VERSION}`);
  });
});