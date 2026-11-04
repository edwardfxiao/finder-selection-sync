module.exports = {
  appId: 'com.finderselectionsync.desktop',
  productName: 'Finder Selection Sync',
  directories: { app: '.build/app', output: 'dist' },
  files: ['*.js', '*.cjs', 'locales/*.json', 'renderer-dist/**/*', 'package.json'],
  asar: true,
  npmRebuild: false,
  forceCodeSigning: true,
  artifactName: 'Finder-Selection-Sync-${version}-${arch}.${ext}',
  mac: {
    icon: 'build/icon.icns',
    category: 'public.app-category.utilities',
    // Ad-hoc signing seals the rebuilt bundle without a Developer ID certificate.
    identity: '-',
    hardenedRuntime: true,
    entitlements: 'build/entitlements.mac.plist',
    entitlementsInherit: 'build/entitlements.mac.plist',
    notarize: false,
    strictVerify: true,
    target: ['dmg'],
  },
  dmg: { title: 'Finder Selection Sync' },
};
