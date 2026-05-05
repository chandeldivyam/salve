import { readFile } from 'node:fs/promises';

export async function readTextArg(value: string | undefined): Promise<string | undefined> {
  if (!value) return undefined;
  if (value === '-') return readStdin();
  if (value.startsWith('@')) return readFile(value.slice(1), 'utf8');
  return value;
}

export async function readJsonArg(value: string | undefined): Promise<unknown> {
  if (!value) return undefined;
  const text = await readTextArg(value);
  if (!text) return undefined;
  return JSON.parse(text);
}

export async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString('utf8');
}

export async function readSecret(prompt: string): Promise<string> {
  if (!process.stdin.isTTY) {
    process.stderr.write(prompt);
    return (await readStdin()).trim();
  }

  process.stderr.write(prompt);
  process.stdin.setRawMode(true);
  process.stdin.resume();
  process.stdin.setEncoding('utf8');

  return new Promise((resolve, reject) => {
    let value = '';
    const cleanup = () => {
      process.stdin.setRawMode(false);
      process.stdin.pause();
      process.stderr.write('\n');
    };
    process.stdin.on('data', function onData(key: string) {
      if (key === '\u0003') {
        cleanup();
        process.stdin.off('data', onData);
        reject(new Error('Login cancelled'));
        return;
      }
      if (key === '\r' || key === '\n') {
        cleanup();
        process.stdin.off('data', onData);
        resolve(value.trim());
        return;
      }
      if (key === '\u007f') {
        value = value.slice(0, -1);
        return;
      }
      value += key;
      process.stderr.write('*');
    });
  });
}
