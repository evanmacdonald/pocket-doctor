# Releasing Pocket Doctor (iOS)

End-to-end release pipeline: every PR builds to TestFlight automatically; a manual GitHub Action promotes a chosen TestFlight build to the App Store. Designed to be drivable from a phone — no laptop required after one-time setup.

## One-time setup

1. **Link the project to EAS** (run locally, once):
   ```bash
   npx eas login
   npx eas init           # writes extra.eas.projectId into app.json
   npx eas credentials    # generate iOS distribution cert + provisioning profile
   ```

2. **Create an App Store Connect API key**
   - App Store Connect → Users & Access → Integrations → Keys → "+"
   - Role: **App Manager**
   - Download the `.p8` (one-time download)
   - Run `npx eas credentials` again, choose iOS → "App Store Connect API Key", and upload the `.p8`. EAS stores it; nothing about the key touches GitHub.

3. **Fill in `eas.json` submit profiles**
   - Replace `REPLACE_WITH_ASC_APP_ID` with the numeric Apple ID for the app (App Store Connect → App → App Information → "Apple ID")
   - Replace `REPLACE_WITH_APPLE_TEAM_ID` with the Team ID from developer.apple.com → Membership

4. **Add `EXPO_TOKEN` to GitHub repo secrets**
   - expo.dev → Account settings → Access tokens → Create
   - GitHub → Settings → Secrets and variables → Actions → New repository secret → name `EXPO_TOKEN`

## Day-to-day flow

1. Open a PR against `main`. The `iOS TestFlight (PR preview)` workflow runs typecheck + tests, then kicks off `eas build --platform ios --profile preview --auto-submit`.
2. Within a few minutes the workflow comments on the PR with the EAS build URL. Tap it on your phone.
3. Once EAS finishes the build and uploads to TestFlight (~15–25 min), open TestFlight on your phone and install.
4. Verify the change. Merge the PR.
5. To ship to the App Store: GitHub → Actions → **iOS App Store release (manual)** → Run workflow → paste the EAS build ID from step 2 → Run.
6. App Store Connect → App → "+ Version" → pick the build → fill release notes → Submit for Review.

## Why these settings exist

- **`ios.config.usesNonExemptEncryption: false`** in `app.json` — sets `ITSAppUsesNonExemptEncryption=false` in Info.plist. We use AES-256-GCM (`react-native-quick-crypto`) only to protect user data on-device, which qualifies for the Apple export-compliance exemption. Without this flag, every TestFlight build is blocked behind a manual encryption questionnaire in App Store Connect.

- **`image: latest`** under `build.*.ios` in `eas.json` — pins EAS to its newest macOS image, which ships Xcode 26+. As of 2026-04-28, App Store Connect rejects builds compiled with anything older than the iOS 26 SDK (warning code 90725). Without this pin, EAS may default to an older image.

- **`buildNumber: "1"`** in `app.json` — `eas.json` has `autoIncrement: true` for the production profile, but EAS needs an initial value present in source to increment from.

## Rollback / recovery

- **Reject a TestFlight build:** App Store Connect → TestFlight → select build → Expire.
- **Reject a submitted binary:** App Store Connect → App → Pending submission → Remove from review.
- **Re-promote an older build:** re-run `iOS App Store release (manual)` with the older build ID.

## Gotchas

- The first PR after merging this pipeline will fail until `EXPO_TOKEN` exists and `eas init` has been run — both are one-time manual steps that can't happen from CI.
- `eas-cli` versions can drift; the workflows pin `eas-version: latest` via `expo-github-action`, but if a breaking change lands, pin to a specific version.
- TestFlight processing can take 10–30 minutes after EAS reports the upload as complete. Be patient before assuming the upload failed.
