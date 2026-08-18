// electron-builder afterSign hook: notarize + staple the signed .app via
// notarytool, so `npm run dist` produces a fully notarized DMG in one command.
//
// Credentials come from a keychain profile (no secrets in the repo/env):
//   xcrun notarytool store-credentials "groundview-notary" \
//     --apple-id <id> --team-id 35597M53Y5 --password <app-specific-pw>
// Override the profile name with NOTARY_KEYCHAIN_PROFILE.
// Skip notarization (signed-only build) with SKIP_NOTARIZE=1.
const { notarize } = require('@electron/notarize');

exports.default = async function notarizing(context) {
  const { electronPlatformName, appOutDir } = context;
  if (electronPlatformName !== 'darwin') return;

  if (process.env.SKIP_NOTARIZE === '1') {
    console.log('  • notarization skipped (SKIP_NOTARIZE=1)');
    return;
  }

  const appName = context.packager.appInfo.productFilename;
  const appPath = `${appOutDir}/${appName}.app`;
  const keychainProfile = process.env.NOTARY_KEYCHAIN_PROFILE || 'groundview-notary';

  console.log(`  • notarizing ${appPath} (keychain profile: ${keychainProfile})`);
  await notarize({
    tool: 'notarytool',
    appPath,
    keychainProfile,
  });
  console.log('  • notarization + staple complete');
};
