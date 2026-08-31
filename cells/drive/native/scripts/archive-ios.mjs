import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { NATIVE, xcodeContainer, run } from './xcode.mjs';

const team = process.env.APPLE_TEAM_ID;
if (!team) throw new Error('APPLE_TEAM_ID is required');
const bundle = process.env.DRIVE_IOS_BUNDLE_ID ?? 'land.parc.drive';
const version = process.env.DRIVE_VERSION ?? '1.0';
const buildNumber = process.env.DRIVE_BUILD_NUMBER ?? '1';
const out = join(NATIVE, 'dist/ios');
const archive = join(out, 'Drive.xcarchive');
const ipa = join(out, 'ipa');
const exportOptions = join(out, 'ExportOptions.plist');

await mkdir(out, { recursive: true });
await writeFile(exportOptions, `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>method</key>
  <string>app-store-connect</string>
  <key>signingStyle</key>
  <string>automatic</string>
  <key>teamID</key>
  <string>${team}</string>
  <key>uploadSymbols</key>
  <true/>
</dict>
</plist>
`);

await run('xcodebuild', [
  ...xcodeContainer(),
  '-scheme', 'App',
  '-configuration', 'Release',
  '-destination', 'generic/platform=iOS',
  '-archivePath', archive,
  `DEVELOPMENT_TEAM=${team}`,
  `PRODUCT_BUNDLE_IDENTIFIER=${bundle}`,
  `MARKETING_VERSION=${version}`,
  `CURRENT_PROJECT_VERSION=${buildNumber}`,
  'CODE_SIGN_STYLE=Automatic',
  '-allowProvisioningUpdates',
  'archive',
]);
await run('xcodebuild', [
  '-exportArchive',
  '-archivePath', archive,
  '-exportPath', ipa,
  '-exportOptionsPlist', exportOptions,
  '-allowProvisioningUpdates',
]);
