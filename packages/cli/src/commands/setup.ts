import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import inquirer from 'inquirer';
import { detectProject, type ProjectInfo, type ProjectType } from '../detect/project.js';
import { installSdk, type InstallResult } from '../install/sdk.js';
import { verifyKey, type VerifiedKey, KeyVerificationError } from '../verify/key.js';
import { generateIntegration, type GenerateOptions, type GenerateResult } from '../generate/integration.js';
import { colors, banner, success, error, warn, info } from '../utils/colors.js';
import { CLIREVENUE_API_BASE_URL } from '../config.js';

const SIZE_CHOICES = [
  { name: 'Responsive (fills container)', value: 'responsive' },
  { name: '320 × 100 (leaderboard)', value: [320, 100] as [number, number] },
  { name: '640 × 180 (large)', value: [640, 180] as [number, number] },
  { name: 'Custom', value: 'custom' },
];

/**
 * Every deliberate failure in setup is raised rather than exited from.
 *
 * `process.exit()` inside a command is what made this CLI look like it was
 * crashing: it tore the process down mid-prompt, and because stdout is
 * buffered when it is a pipe (which is exactly how `npx` runs a bin), the
 * explanation the CLI had just printed was frequently thrown away. The
 * message now propagates to the entry point, which prints it, then sets
 * `process.exitCode` so Node can flush before exiting non-zero.
 */
export class SetupError extends Error {
  constructor(message: string, public readonly hint?: string) {
    super(message);
    this.name = 'SetupError';
  }
}

function getBaseUrlForEnv(_projectType: ProjectType): string {
  return CLIREVENUE_API_BASE_URL;
}

async function promptCustomSize(): Promise<[number, number]> {
  const answers = await inquirer.prompt([
    {
      type: 'input',
      name: 'width',
      message: 'Width (px):',
      default: '320',
      validate: (v: string) => {
        const n = Number(v);
        return (Number.isInteger(n) && n >= 120 && n <= 1280) || 'Enter a number between 120 and 1280';
      },
    },
    {
      type: 'input',
      name: 'height',
      message: 'Height (px):',
      default: '100',
      validate: (v: string) => {
        const n = Number(v);
        return (Number.isInteger(n) && n >= 60 && n <= 1024) || 'Enter a number between 60 and 1024';
      },
    },
  ]);
  return [Number(answers.width), Number(answers.height)];
}

function hasExistingCliRevenue(root: string): boolean {
  const envPath = join(root, '.env.local');
  const libPath = join(root, 'src/lib/clirevenue.js');
  const compPath = join(root, 'src/components/CLIRevenueAd.jsx');

  try {
    if (existsSync(envPath)) {
      const content = readFileSync(envPath, 'utf8');
      if (content.includes('CLIREVENUE')) return true;
    }
    if (existsSync(libPath)) {
      const content = readFileSync(libPath, 'utf8');
      if (content.includes('@clirevenue/sdk')) return true;
    }
    if (existsSync(compPath)) {
      return true;
    }
  } catch {
    // ignore read errors
  }
  return false;
}

function getExistingKey(root: string): string | null {
  const envPath = join(root, '.env.local');
  if (!existsSync(envPath)) return null;
  try {
    const content = readFileSync(envPath, 'utf8');
    const match = content.match(/^VITE_CLIREVENUE_PUBLISHABLE_KEY=(.+)$/m);
    if (match) return match[1].trim();
  } catch {
    // ignore
  }
  return null;
}

function basename(path: string): string {
  const parts = path.split(/[/\\]/);
  return parts[parts.length - 1];
}

function maskKey(key: string): string {
  if (key.length <= 16) return `${key.slice(0, 4)}••••${key.slice(-4)}`;
  return `${key.slice(0, 8)}••••${key.slice(-4)}`;
}

export async function setup() {
  console.log(banner('CLIRevenue Setup'));
  console.log('');

  /* The user's working directory, never the CLI's own package directory.
     `npx` runs the bin from its own cache directory, so anything that
     assumed `process.cwd()` was the CLI would look at the wrong project
     entirely. */
  const cwd = process.cwd();

  console.log(info('Detecting project...'));

  const project = detectProject(cwd);
  if (project.type !== 'vite-react') {
    throw new SetupError(
      'Unsupported project.',
      `CLIRevenue setup supports Vite + React projects. Run it from your app's root (${project.root}).`,
    );
  }

  if (hasExistingCliRevenue(project.root)) {
    console.log(warn('CLIRevenue already appears in this project. Re-running will refresh its own files.'));
    console.log('');
  }

  console.log(success('Vite + React detected'));
  console.log('');

  // SDK installation
  console.log(info('CLIRevenue SDK'));
  let installResult: InstallResult;
  try {
    /* Awaited, and `spawn`-based underneath, so npm's output streams to
       the real terminal instead of the process freezing in silence. */
    installResult = await installSdk(project.root);
  } catch (err) {
    throw new SetupError(err instanceof Error ? err.message : 'Failed to install SDK');
  }

  if (installResult.alreadyInstalled) {
    console.log(colors.dim(`@clirevenue/sdk already installed`));
  } else {
    console.log(success('@clirevenue/sdk installed'));
  }
  console.log('');

  // Publishable key
  const existingKey = getExistingKey(project.root);
  let rawKey: string;

  if (existingKey) {
    rawKey = existingKey;
    console.log(info(`Publishable key: ${colors.dim(maskKey(rawKey))}`));
  } else {
    const keyAnswer = await inquirer.prompt([
      {
        type: 'input',
        name: 'key',
        message: 'Publishable key:',
        validate: (v: string) => {
          if (!v.trim()) return 'Key is required';
          if (!/^pk_(live|test)_[A-Za-z0-9_-]{32,}$/.test(v.trim())) {
            return 'Key must start with pk_test_... or pk_live_...';
          }
          return true;
        },
      },
    ]);
    rawKey = keyAnswer.key.trim();
  }

  // Verify key and get placements
  console.log(info('Verifying key...'));
  let verified: VerifiedKey;
  try {
    verified = await verifyKey(rawKey, getBaseUrlForEnv(project.type));
  } catch (err) {
    if (err instanceof KeyVerificationError) {
      throw new SetupError(err.message);
    }
    throw new SetupError(err instanceof Error ? err.message : 'Key verification failed');
  }

  console.log(success('Key verified'));
  console.log(success(`Publisher identified`));
  console.log('');

  // Placement selection
  const placements = verified.placements;
  if (placements.length === 0) {
    throw new SetupError(
      'No placements found for this publisher.',
      'Create a placement in the CLIRevenue dashboard and try again.',
    );
  }

  console.log(info('Available placements:'));
  const choices = placements.map((p, idx) => ({
    name: `${idx + 1}. ${p.name} (${p.key})${p.enabled ? '' : ' [disabled]'}`,
    value: p.key,
    short: p.name,
  }));

  const placementAnswer = await inquirer.prompt([
    {
      type: 'list',
      name: 'placement',
      message: 'Choose placement:',
      choices,
      pageSize: Math.min(choices.length + 2, 15),
    },
  ]);

  /* Resolved by value rather than by index into a non-null-asserted
     `find`, so a backend response we did not expect produces a readable
     error instead of a TypeError. */
  const selected = placements.find((p) => p.key === placementAnswer.placement);
  if (!selected) {
    throw new SetupError('The chosen placement was not in the list returned by the API.');
  }
  const selectedPlacement: VerifiedKey['placements'][number] = selected;
  console.log(success(`Placement: ${selectedPlacement.name}`));
  console.log('');

  // Size selection
  const sizeAnswer = await inquirer.prompt([
    {
      type: 'list',
      name: 'size',
      message: 'Ad size:',
      choices: SIZE_CHOICES.map((c) => ({
        name: c.value === 'responsive' ? 'Responsive' : Array.isArray(c.value) ? `${c.value[0]} × ${c.value[1]}` : 'Custom',
        value: c.value,
        short: c.value === 'responsive' ? 'Responsive' : Array.isArray(c.value) ? `${c.value[0]}×${c.value[1]}` : 'Custom',
      })),
      default: 'responsive',
    },
  ]);

  let size: 'responsive' | [number, number] = 'responsive';
  const rawSize = sizeAnswer.size as string | [number, number];
  if (rawSize === 'custom') {
    size = await promptCustomSize();
  } else if (Array.isArray(rawSize)) {
    size = rawSize;
  }

  const sizeLabel = size === 'responsive' ? 'Responsive' : `${size[0]} × ${size[1]}`;
  console.log(success(`Size: ${sizeLabel}`));
  console.log('');

  // Generate integration
  console.log(info('Configuring project...'));

  const opts: GenerateOptions = {
    projectRoot: project.root,
    publisherKey: rawKey,
    baseUrl: getBaseUrlForEnv(project.type),
    placementKey: selectedPlacement.key,
    placementName: selectedPlacement.name,
    size,
  };

  const result = generateIntegration(opts);

  const envName = basename(result.envFile);
  const libName = basename(result.libFile);
  const compName = basename(result.componentFile);

  console.log(success(`Environment configured (${envName})`));
  console.log(describeWrite(libName, result, result.libFile));
  console.log(describeWrite(compName, result, result.componentFile));
  if (result.preserved.length > 0) {
    console.log('');
    console.log(
      warn(
        `Left untouched (already existed and was not written by this CLI): ${result.preserved
          .map(basename)
          .join(', ')}`,
      ),
    );
  }
  console.log('');

  console.log(banner('CLIRevenue is ready.'));
  console.log('');
  console.log('Next steps:');
  console.log(`  1. Import <${compName} /> in your app and place it where you want the ad.`);
  console.log(`  2. Run ${colors.cyan('npm run dev')} to see it live.`);
  console.log('');
  console.log(colors.dim(`SDK: @clirevenue/sdk`));
  console.log(colors.dim(`Placement: ${selectedPlacement.key}`));
  console.log(colors.dim(`Size: ${sizeLabel}`));
  console.log('');

  return result;
}

function describeWrite(name: string, result: GenerateResult, path: string): string {
  if (result.preserved.includes(path)) {
    return colors.dim(`Kept existing ${name} (not written by this CLI)`);
  }
  if (result.updated.includes(path)) {
    return success(`Updated ${name}`);
  }
  return success(`Created ${name}`);
}