import pc from 'picocolors';

export const colors = {
  dim: (text: string) => pc.dim(text),
  green: (text: string) => pc.green(text),
  red: (text: string) => pc.red(text),
  yellow: (text: string) => pc.yellow(text),
  cyan: (text: string) => pc.cyan(text),
  bold: (text: string) => pc.bold(text),
};

export const banner = (title: string) => {
  const line = '─'.repeat(24);
  return `${colors.bold(title)}\n${line}`;
};

export const success = (msg: string) => `\n${colors.green('✓')} ${msg}`;
export const error = (msg: string) => `${colors.red('✗')} ${msg}`;
export const warn = (msg: string) => `${colors.yellow('!')} ${msg}`;
export const info = (msg: string) => `${colors.cyan('›')} ${msg}`;
