module.exports = {
  appId: 'com.finderselectionsync.desktop',
  productName: 'Finder Selection Sync',
  directories: { app: '.build/app', output: 'dist' },
  files: ['*.js', '*.cjs', 'locales/*.json', 'renderer-dist/**/*', 'package.json'],
  asar: true,
  npmRebuild: false,
  artifactName: 'Finder-Selection-Sync-${version}-${arch}.${ext}',
  mac: {
    category: 'public.app-category.utilities',
    identity: null,
    target: ['dmg'],
  },
  dmg: { title: 'Finder Selection Sync' },
};
