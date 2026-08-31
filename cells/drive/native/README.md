# Drive native distribution

One packaged web build feeds two shells:

- Electron packages unpacked Windows, macOS, and Linux applications for SteamPipe.
- Capacitor owns the iOS Xcode project and App Store archive.

The game itself is bundled into `dist/web`; neither shell loads executable code
from the deployed website. Electron serves it from the privileged `drive://app`
origin and proxies only the live cell/auth APIs. Capacitor uses its native HTTP
bridge for those APIs. Native sign-in uses OAuth device authorization, so no
custom callback scheme or embedded authentication page is required.

Platform icon files under `electron/icons/` and the iOS asset catalogue are
derived from the editable placeholder masters under `artwork/`.

## Setup

```sh
cd cells/drive/native
npm ci
npm run typecheck
npm test
npm run web
npm run verify
```

Node 22.12 or newer is required by Capacitor 8.

## Electron and Steam

Run the local desktop shell with `npm run desktop`. Build the current platform
with `npm run desktop:pack`, or use `desktop:win`, `desktop:mac`, and
`desktop:linux` on their native CI runners. Outputs land under
`dist/electron`; Steam receives unpacked applications, not installers.
`npm run desktop:archive -- macos` (or `windows`/`linux`) creates a tarball
that preserves executable modes and framework symlinks across CI artifacts.

Stage a completed package and generate SteamPipe manifests:

```sh
cp steam.env.example steam.env
STEAM_APP_ID=... npm run steam:stage -- windows
STEAM_APP_ID=... npm run steam:stage -- macos
STEAM_APP_ID=... npm run steam:stage -- linux
set -a; . ./steam.env; set +a
npm run steam:config
npm run steam:upload
```

`steam:stage all` stages every package present on disk. Steam IDs, the build
account, and an optional branch name (`STEAM_SET_LIVE`) are environment inputs.
The generated VDF files and SteamCMD logs are under `dist/steam`. Configure one
Steam launch option per depot in Steamworks:

| OS | Executable |
| --- | --- |
| Windows | `Drive.exe` |
| macOS | `Drive.app` |
| Linux | `drive` |

Use a dedicated Steam build account. Leave `STEAM_PASSWORD` unset for an
interactive Steam Guard login, or provide it only through a CI secret store.

A guarded account cannot log in from a fresh CI runner on a password alone —
SteamCMD authorises a machine once and remembers it, and a runner is a new
machine every time. Authorise the build account by hand once, then carry its
login state across runs in `STEAM_CONFIG_VDF`:

```sh
steamcmd +login <build-account> +quit    # answer the Steam Guard prompt
base64 -w0 ~/Steam/config/config.vdf     # store this as the secret
```

Code-sign Windows and macOS release builds by supplying electron-builder's
standard `CSC_*` environment variables. Steam does not replace macOS signing
and notarization. Signing variables are read only when they are non-empty: an
unset repository secret reaches the runner as an empty string, and
`scripts/signing-env.mjs` deletes those before electron-builder can mistake one
for a certificate path.

## iOS

Create the native project once:

```sh
DRIVE_IOS_BUNDLE_ID=land.parc.drive npm run ios:add
```

Commit `ios/`. Subsequent web/native updates use `npm run ios:sync`. Open Xcode
with `npm run ios:open`, or verify an unsigned simulator build with
`npm run ios:build`.

Create a signed App Store Connect IPA with:

```sh
APPLE_TEAM_ID=... DRIVE_IOS_BUNDLE_ID=land.parc.drive \
  DRIVE_VERSION=1.0 DRIVE_BUILD_NUMBER=1 npm run ios:archive
```

The archive and exported IPA land under `dist/ios`. Automatic signing requires
an installed distribution certificate and an authenticated Xcode account.
Placeholder artwork, editable SVG masters, and production image-generation
prompts live under `artwork/`. Before release, replace the placeholders with
selected production artwork and review the location/motion usage copy in
`ios/App/App/Info.plist`.

## CI

`.github/workflows/drive-native.yml` runs in two modes.

A pull request that touches `cells/drive/native/**` runs the checks — typecheck,
tests, web build, `verify` — on Windows, macOS and Linux, and stops there.
Three runners for a check that mostly does the same thing three times looks
extravagant until you notice that the first release run failed on Windows
alone, on a Node rule (`import()` takes a URL, and `D:\...` is not one) that
no amount of testing on the other two can reach.

A manual dispatch runs those same checks and then packages all three Steam
platforms on native runners and verifies the iOS simulator target. Its
`upload_steam` option consolidates the artifacts and uploads all configured
depots; leaving `steam_branch` blank creates an unpublished Steam build.
Configure `STEAM_APP_ID`, the three `STEAM_DEPOT_*` IDs, `STEAM_USER`,
`STEAM_PASSWORD` and `STEAM_CONFIG_VDF` as repository secrets.
Signed/notarized releases need the corresponding Apple and Windows signing
secrets added to the workflow; leaving them unconfigured produces an unsigned
build rather than a failed one.
