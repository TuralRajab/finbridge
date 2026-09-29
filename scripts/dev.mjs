// Starts the API server and the Vite dev server together (no extra dependencies).
import { spawn } from 'node:child_process';

const isWin = process.platform === 'win32';
const npm = isWin ? 'npm.cmd' : 'npm';
const procs = [
  ['server', ['run', 'dev', '-w', 'server']],
  ['web', ['run', 'dev', '-w', 'web']],
].map(([name, args]) => {
  const p = spawn(npm, args, { stdio: ['inherit', 'pipe', 'pipe'], shell: isWin });
  const tag = name === 'server' ? '\x1b[36m[server]\x1b[0m ' : '\x1b[35m[web]\x1b[0m    ';
  for (const stream of [p.stdout, p.stderr]) {
    stream.on('data', (d) => process.stdout.write(d.toString().split('\n').filter(Boolean).map((l) => tag + l).join('\n') + '\n'));
  }
  p.on('exit', (code) => {
    console.log(`${tag}exited with code ${code}`);
    procs.forEach((o) => o !== p && o.kill());
    process.exit(code ?? 0);
  });
  return p;
});
process.on('SIGINT', () => procs.forEach((p) => p.kill()));
