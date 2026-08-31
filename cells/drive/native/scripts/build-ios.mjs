import { xcodeContainer, run } from './xcode.mjs';

await run('xcodebuild', [
  ...xcodeContainer(),
  '-scheme', 'App',
  '-configuration', 'Debug',
  '-sdk', 'iphonesimulator',
  '-destination', 'generic/platform=iOS Simulator',
  'CODE_SIGNING_ALLOWED=NO',
  'build',
]);
