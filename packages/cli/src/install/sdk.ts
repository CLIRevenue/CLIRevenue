import { spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CLIREVENUE_SDK_VERSION } from '../config.js';

export interface InstallResult {
  packageManager: string;
  command: string;
  alreadyInstalled: boolean;
}

export class InstallError extends Error {
  constructor(message: string, public readonly code: string) {
    super(message);
    this.name = 'InstallError';
  }
}

/** Injection points, so the install path is testable without spawning npm. */
export interface InstallOptions {
  spawnFn?: typeof spawn;
  write?: (message: string) => void;
}

export function detectPackageManager(root: string): 'npm' | 'pnpm' | 'yarn' | 'bun' {
  if (existsSync(join(root, 'pnpm-lock.yaml'))) return 'pnpm';
  if (existsSync(join(root, 'yarn.lock'))) return 'yarn';
  if (existsSync(join(root, 'bun.lockb'))) return 'bun';
  return 'npm';
}

export function getInstallCommand(
  pm: 'npm' | 'pnpm' | 'yarn' | 'bun',
  packageName: string,
): string {
  switch (pm) {
    case 'npm':
      return `npm install ${packageName}`;
    case 'pnpm':
      return `pnpm add ${packageName}`;
    case 'yarn':
      return `yarn add ${packageName}`;
    case 'bun':
      return `bun add ${packageName}`;
  }
}

export function isSdkInstalled(
  root: string,
  requiredVersion = CLIREVENUE_SDK_VERSION,
): boolean {
  const packageJsonPath = join(root, 'node_modules', '@clirevenue', 'sdk', 'package.json');

  if (!existsSync(packageJsonPath)) {
    return false;
  }

  try {
    const packageJson = JSON.parse(
      readFileSync(packageJsonPath, 'utf8'),
    ) as { version?: string };

    return packageJson.version === requiredVersion;
  } catch {
    return false;
  }
}

export async function installSdk(
  root: string,
  packageName = `@clirevenue/sdk@${CLIREVENUE_SDK_VERSION}`,
  options: InstallOptions = {},
): Promise<InstallResult> {
  const pm = detectPackageManager(root);
  const command = getInstallCommand(pm, packageName);

  if (isSdkInstalled(root, CLIREVENUE_SDK_VERSION)) {
    return { packageManager: pm, command, alreadyInstalled: true };
  }

  const runSpawn = options.spawnFn ?? spawn;
  const write = options.write ?? ((message: string) => void process.stdout.write(message));

  write(`Installing ${packageName} with ${pm}…\n`);

  /* `spawn`, not `execSync`.
     `execSync` blocks this thread until the child exits and captures its
     output into a pipe. For an `npm install` that is tens of seconds of a
     completely silent terminal — no spinner, no output, no event loop —
     which reads as a hung or crashed shell. `spawn` keeps the event loop
     running and, with `stdio: 'inherit'`, lets npm write straight to the
     real terminal so progress is visible the whole way through. */
  return new Promise<InstallResult>((resolve, reject) => {
    const [bin, ...args] = command.split(' ');

    const child: ChildProcess = runSpawn(bin, args, {
      cwd: root,
      stdio: 'inherit',
      /* npm, pnpm, yarn and bun all install through a `.cmd`/`.ps1`
         shim on Windows, which only resolves through a shell. This is
         what makes `npx clirevenue setup` work under cmd.exe and
         PowerShell; on POSIX it stays off so the command is not handed
         to a shell at all. */
      shell: process.platform === 'win32',
      /* Deliberately not forcing CI=true: it is only needed to stop npm
         prompting, and npm install here is never interactive. Forcing it
         changed npm's output and its update behaviour for no benefit. */
      env: process.env,
    });

    let settled = false;

    child.on('error', (error: Error) => {
      if (settled) return;
      settled = true;
      reject(
        new InstallError(
          `Could not run \`${command}\` in ${root}: ${error.message}`,
          'install_spawn_failed',
        ),
      );
    });

    child.on('close', (code, signal) => {
      if (settled) return;
      settled = true;

      if (signal) {
        reject(
          new InstallError(
            `\`${command}\` was terminated by ${signal} before it finished.`,
            'install_failed',
          ),
        );
        return;
      }

      if (code !== 0) {
        reject(
          new InstallError(
            `\`${command}\` exited with code ${code}. Install ${packageName} manually and re-run setup.`,
            'install_failed',
          ),
        );
        return;
      }

      resolve({ packageManager: pm, command, alreadyInstalled: false });
    });
  });
}