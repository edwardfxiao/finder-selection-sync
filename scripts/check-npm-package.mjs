import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const exec = promisify(execFile);
const repositoryRoot = fileURLToPath(new URL('..', import.meta.url));
const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'finder-npm-package-'));
const env = { ...process.env, npm_config_cache: path.join(temporary, 'cache'), npm_config_update_notifier: 'false' };
try {
  const root = JSON.parse(await fs.readFile(path.join(repositoryRoot, 'package.json'), 'utf8'));
  assert.equal(root.main, './src/index.js');
  assert.equal(Object.keys(root.dependencies ?? {}).length, 0, 'CLI must not acquire desktop runtime dependencies');
  const { stdout } = await exec('npm', ['pack', '--json', '--ignore-scripts', '--pack-destination', temporary], { cwd: repositoryRoot, env });
  const [archive] = JSON.parse(stdout);
  const files = archive.files.map(file => file.path);
  for (const file of files) assert.match(file, /^(?:bin\/|src\/|package\.json$|README\.md$|LICENSE$)/, `Unexpected npm payload: ${file}`);
  assert.ok(files.includes(root.bin['finder-selection-sync']));
  assert.ok(files.includes('src/index.js'));
  const consumer = path.join(temporary, 'consumer');
  await fs.mkdir(consumer);
  await fs.writeFile(path.join(consumer, 'package.json'), '{"name":"cli-consumer-check","private":true,"type":"module"}\n');
  await exec('npm', ['install', '--offline', '--ignore-scripts', '--omit=dev', '--no-audit', '--no-fund', '--package-lock=false', path.join(temporary, archive.filename)], { cwd: consumer, env });
  const bin = path.join(consumer, 'node_modules/.bin/finder-selection-sync');
  const version = await exec(bin, ['--version'], { cwd: consumer, env });
  assert.ok(version.stdout.includes(root.version));
  for (const args of [['--help'], ['clean-orphans', '--help'], ['clean-list', '--help']]) {
    const help = await exec(bin, args, { cwd: consumer, env });
    assert.match(help.stdout, /Usage:/);
  }
  await exec(process.execPath, ['--input-type=module', '-e', `
    import assert from 'node:assert/strict';
    const core = await import(${JSON.stringify(root.name)});
    const cleanup = await import(${JSON.stringify(`${root.name}/cleanup`)});
    const files = await import(${JSON.stringify(`${root.name}/files`)});
    assert.equal(typeof core.main, 'function');
    assert.equal(typeof cleanup.prepareCleanup, 'function');
    assert.equal(typeof files.getFiles, 'function');
    assert.equal(core.VERSION, ${JSON.stringify(root.version)});
  `], { cwd: consumer, env });
  await assert.rejects(fs.access(path.join(consumer, 'node_modules/electron')));
  console.log(`npm package verified: ${files.length} files, CLI commands and shared-core exports work without Electron.`);
} finally {
  await fs.rm(temporary, { recursive: true, force: true });
}
