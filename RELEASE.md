# Releasing Pocket Doctor (iOS)

End-to-end release pipeline: every PR builds to TestFlight automatically; a manual GitHub Action promotes a chosen TestFlight build to the App Store. Designed to be drivable from a phone — no laptop required after one-time setup.

## One-time setup

> Already done for this repo. This section is preserved for reference / disaster recovery.

1. **Link the project to EAS** (run locally, once):
   ```bash
   npx eas login
   npx eas init           # writes extra.eas.projectId into app.json
   npx eas credentials    # generate iOS distribution cert + provisioning profile
   ```
   Choose **Build Credentials → All: Set up all the required credentials** and let EAS generate the cert + provisioning profile against your Apple Developer account.

2. **Create an App Store Connect API key**
   - App Store Connect → Users and Access → Integrations → Keys → "+"
   - Role: **App Manager** (or Admin)
   - Download the `.p8` (one-time download)
   - Run `npx eas credentials` again, choose iOS → "App Store Connect: Manage your API Key", and upload the `.p8`. EAS stores it; nothing about the key touches GitHub.

3. **Fill in `eas.json` submit profiles** with your numeric App Store Connect app ID (App Store Connect → App → App Information → "Apple ID") and your Apple Team ID (developer.apple.com → Membership).

4. **Add `EXPO_TOKEN` to GitHub repo secrets**
   - expo.dev → Account settings → Access tokens → Create
   - GitHub → Settings → Secrets and variables → Actions → New repository secret → name `EXPO_TOKEN`

## Day-to-day flow

1. Open a PR against `main`. The `iOS TestFlight (PR preview)` workflow runs typecheck + tests, then kicks off `eas build --platform ios --profile preview --auto-submit`.
2. When the build finishes (~15–25 min), the workflow comments on the PR with the EAS build URL. Tap it on your phone to watch progress or copy the build ID for later.
3. Once EAS finishes the build and the auto-submit uploads it to TestFlight (another ~5–15 min of processing on Apple's side), open TestFlight on your phone and install.
4. Verify the change. Merge the PR.
5. To ship to the App Store: GitHub → Actions → **iOS App Store release (manual)** → Run workflow → paste the EAS build ID (the UUID at the end of the build URL from step 2) → Run.
6. App Store Connect → App → "+ Version" → pick the build → fill release notes → Submit for Review.

## Why these settings exist

- **`ios.config.usesNonExemptEncryption: false`** in `app.json` — sets `ITSAppUsesNonExemptEncryption=false` in Info.plist. We use AES-256-GCM (`react-native-quick-crypto`) only to protect user data on-device, which qualifies for the Apple export-compliance exemption. Without this flag, every TestFlight build is blocked behind a manual encryption questionnaire in App Store Connect.

- **`image: latest`** under `build.*.ios` in `eas.json` — pins EAS to its newest macOS image, which ships Xcode 26+. As of 2026-04-28, App Store Connect rejects builds compiled with anything older than the iOS 26 SDK (warning code 90725). Without this pin, EAS may default to an older image.

- **`buildNumber: "1"`** in `app.json` — `eas.json` has `autoIncrement: true` for the production profile, but EAS needs an initial value present in source to increment from.

- **`preview` profile uses store distribution (no `distribution: internal`)** — TestFlight requires a store-distribution build signed with the App Store cert. An `internal` profile would need ad-hoc credentials and registered devices, which we don't use. Both `preview` and `production` build with the same cert; the only difference is `autoIncrement` on production.

## Rollback / recovery

- **Reject a TestFlight build:** App Store Connect → TestFlight → select build → Expire.
- **Reject a submitted binary:** App Store Connect → App → Pending submission → Remove from review.
- **Re-promote an older build:** re-run `iOS App Store release (manual)` with the older build ID.

## Gotchas

- **EAS free tier quota:** 30 iOS builds per month on the free tier, and builds count as soon as they're queued — failed and cancelled builds still count. Each PR push triggers a build (concurrency cancels in-flight ones, which also count). If you start hitting the limit, gate the workflow behind a `testflight` label on the PR.
- **`eas-cli` flag gotchas** (learned the hard way when setting this up):
  - `--json` requires `--no-wait`, but `--no-wait` is incompatible with `--auto-submit`. You can have synchronous auto-submit *or* JSON output, not both.
  - There is no `--submit-profile` flag on `eas build`. With `--auto-submit`, EAS uses the submit profile whose name matches the build profile (we use `preview` for both).
- **`npm ci` fails after adding a dependency** unless `package-lock.json` is updated and committed alongside `package.json`. Obvious in retrospect; still bit us once.
- **`eas-cli` versions can drift**; workflows pin `eas-version: latest` via `expo-github-action`, but if a breaking change lands, pin to a specific version in `.github/workflows/ios-*.yml`.
- **TestFlight processing** can take 10–30 minutes after EAS reports the upload as complete. Be patient before assuming the upload failed.
