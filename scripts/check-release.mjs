import fs from 'node:fs/promises';

const [channel, tag] = process.argv.slice(2);
if (!['npm', 'desktop'].includes(channel)) throw new Error('Usage: node scripts/check-release.mjs npm|desktop [tag]');
const root = JSON.parse(await fs.readFile(new URL('../package.json', import.meta.url), 'utf8'));
const metadata = channel === 'npm' ? root : JSON.parse(await fs.readFile(new URL('../electron/package.json', import.meta.url), 'utf8'));
const prefix = channel === 'npm' ? 'npm-v' : 'desktop-v';
if (tag && tag !== `${prefix}${metadata.version}`) {
  throw new Error(`Tag ${tag} does not match ${channel} version ${metadata.version}; expected ${prefix}${metadata.version}.`);
}
if (channel === 'npm') {
  const url = typeof root.repository === 'string' ? root.repository : root.repository?.url;
  const repository = url?.match(/^git\+https:\/\/github\.com\/(.+?)\.git$/)?.[1];
  if (!repository || repository.split('/')[0] === 'example') {
    throw new Error('Before publishing, replace the example repository/homepage/bugs/author metadata in package.json with your own GitHub repository and account.');
  }
  if (process.env.GITHUB_REPOSITORY && repository.toLowerCase() !== process.env.GITHUB_REPOSITORY.toLowerCase()) {
    throw new Error('package.json repository must match GITHUB_REPOSITORY for npm provenance.');
  }
  if (root.private) throw new Error('The CLI package must be publishable.');
} else if (!metadata.private) {
  throw new Error('The Electron package must remain private; publish its installers through GitHub Releases.');
}
console.log(`Validated ${channel} ${metadata.version}${tag ? ` (${tag})` : ''}.`);
