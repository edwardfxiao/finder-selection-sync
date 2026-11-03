import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const defaultElectronRoot = fileURLToPath(new URL('..', import.meta.url));
export const runtimeFiles = [
  'main.js', 'preload.cjs', 'service.js', 'i18n.js', 'messages.js',
  'image-formats.js', 'image-previews.js', 'preview-controller.js',
];

// Development uses the local file:.. dependency. A release gets a standalone
// copy of that same core, including its own version metadata, with no symlinks.
export async function prepareApp({
  electronRoot = defaultElectronRoot,
  repositoryRoot = path.resolve(electronRoot, '..'),
  outputDirectory = path.join(electronRoot, '.build/app'),
} = {}) {
  const readPackage = async directory => JSON.parse(await fs.readFile(path.join(directory, 'package.json'), 'utf8'));
  const core = await readPackage(repositoryRoot);
  const desktop = await readPackage(electronRoot);
  await fs.rm(outputDirectory, { recursive: true, force: true });
  await fs.mkdir(outputDirectory, { recursive: true });
  for (const name of [...runtimeFiles, 'locales', 'renderer-dist']) {
    await fs.cp(path.join(electronRoot, name), path.join(outputDirectory, name), { recursive: true });
  }
  const coreDirectory = path.join(outputDirectory, 'node_modules/finder-selection-sync');
  await fs.mkdir(coreDirectory, { recursive: true });
  for (const name of ['src', 'bin', 'package.json']) {
    await fs.cp(path.join(repositoryRoot, name), path.join(coreDirectory, name), { recursive: true });
  }
  for (const name of ['README.md', 'LICENSE']) {
    try { await fs.copyFile(path.join(repositoryRoot, name), path.join(coreDirectory, name)); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  const manifest = {
    name: desktop.name, version: desktop.version, private: true,
    description: desktop.description, type: 'module', main: 'main.js',
    author: desktop.author, license: desktop.license,
    dependencies: { 'finder-selection-sync': core.version },
  };
  await fs.writeFile(path.join(outputDirectory, 'package.json'), JSON.stringify(manifest, null, 2) + '\n');
  return { outputDirectory, desktopVersion: desktop.version, coreVersion: core.version };
}

if (path.resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) {
  const result = await prepareApp();
  console.log(`Prepared desktop ${result.desktopVersion} with shared core ${result.coreVersion}: ${result.outputDirectory}`);
}
