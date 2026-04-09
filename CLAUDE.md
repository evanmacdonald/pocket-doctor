# Pocket Doctor — Claude Instructions

## Git Workflow Rules
- **Always submit changes as a PR.** Never directly merge or push to main. This applies even when the user says "ship it", "commit it", or similar — always create a PR instead.

## Project Overview
Local-first iOS health record app built with Expo (React Native). All data lives on-device in SQLite. Users bring their own LLM API key (OpenAI / Anthropic / Gemini). Zero backend, zero server cost. MIT licensed.

## Tech Stack
- **Framework:** Expo SDK 55, React Native, Expo Router v4 (file-based routing)
- **Language:** TypeScript (strict)
- **Styling:** NativeWind v4 (Tailwind CSS for React Native)
- **Database:** expo-sqlite + drizzle-orm (SQLite on-device)
- **Search:** SQLite FTS5 (keyword), sqlite-vec (RAG embeddings — pre-v1, pinned) — **being removed in PR 1, see Roadmap below**
- **LLM:** Direct REST fetch to OpenAI / Anthropic / Gemini — no SDKs (incompatible with Hermes)
- **Secrets:** expo-secure-store (iOS Keychain, WHEN_UNLOCKED_THIS_DEVICE_ONLY)
- **Encryption:** react-native-quick-crypto + react-native-nitro-modules (AES-256-GCM)
- **Build:** `npx expo run:ios` for dev builds (required for Keychain + native modules)

## Key Architecture Rules
- **No backend.** All logic runs on-device. Never add a server, API route, or cloud sync.
- **No LLM SDKs.** Use direct `fetch()` REST calls only — SDKs are incompatible with Hermes.
- **Drizzle schema = source of truth.** Tables are created via `CREATE TABLE IF NOT EXISTS` in `src/db/client.ts` `openDatabase()` — not drizzle-kit migrations.
- **PDF ingestion uses Gemini inline PDF** — binary PDFs are sent as base64 `inline_data` parts, not text-extracted. (Being generalised in PR 2 to support all providers.)
- **Active provider is auto-detected** via `listModels()` — never hardcode a Gemini model name.

## Project Structure
```
app/
  (tabs)/           # Tab screens: Records, Chat, Settings
    index.tsx       # Health Records + Documents screen
    settings/       # Settings stack (index + api-keys)
  records/[id].tsx  # FHIR resource detail
  _layout.tsx       # Root layout, calls openDatabase() on startup

src/
  db/
    client.ts       # SQLite init, table creation, FTS helpers
    schema.ts       # drizzle-orm table definitions
    repositories/   # fhir, chat, settings, audit repositories
  ingestion/
    pipeline.ts     # storeDocument(), processDocument(), deleteDocument()
    queue.ts        # In-memory async job queue
    normalizers/    # fhir.normalizer.ts — LLM → FHIR R4 Bundle
  llm/
    types.ts        # Shared interfaces, DEFAULT_MODELS
    provider-registry.ts  # Lazy provider instantiation from Keychain
    providers/      # openai, anthropic, gemini — all use fetch()
  rag/
    rag.service.ts  # sqlite-vec embeddings + ANN search  (deleted in PR 1)
    fts.service.ts  # FTS5 keyword search                 (deleted in PR 1)
    context-builder.ts  # Builds full-record LLM context  (moved to src/llm/ in PR 1)
  backup/
    export.service.ts / import.service.ts / crypto.service.ts
```

## Development Workflow
```bash
# Start Metro bundler
npx expo start

# Full native build (required after native dep changes)
LANG=en_US.UTF-8 LC_ALL=en_US.UTF-8 npx expo run:ios

# TypeScript check
node node_modules/typescript/bin/tsc --noEmit

# Pod install (after adding native deps)
LANG=en_US.UTF-8 LC_ALL=en_US.UTF-8 pod install
```

## Releases
- See `RELEASE.md` for the full pipeline. PRs auto-build to TestFlight via `.github/workflows/ios-testflight.yml`; App Store releases go through `.github/workflows/ios-release.yml` (manual workflow_dispatch).
- **Never remove `ios.config.usesNonExemptEncryption: false` from `app.json`** — without it, every build is blocked behind the App Store Connect encryption questionnaire. Our use of AES-256-GCM for on-device backups qualifies for Apple's exemption.
- **Never remove `image: latest` from `eas.json` `build.*.ios`** — App Store Connect requires builds compiled with the iOS 26 SDK or later (Xcode 26+). The `latest` image tracks EAS's newest macOS image which ships Xcode 26+.
- **EAS free tier = 30 iOS builds/month**, and failed/cancelled builds still count. Be deliberate about pushing commits to open PRs.

## Common Gotchas
- **`npx expo start` vs `npx expo run:ios`:** Keychain (expo-secure-store) and native modules require `run:ios`. Metro alone won't work.
- **Ruby encoding crash in CocoaPods:** Always prefix pod commands with `LANG=en_US.UTF-8 LC_ALL=en_US.UTF-8`.
- **Gemini model names:** Don't hardcode them — call `provider.listModels()` and pick a flash model dynamically.
- **PDF text extraction fails on binary PDFs:** The pipeline falls back to sending raw bytes to Gemini as `inline_data`.
- **expo-file-system v55:** Import from `expo-file-system/legacy` not `expo-file-system`.
- **iOS 26 simulator:** Clipboard paste is broken — type API keys manually or use an iOS 18 simulator.
- **Stuck documents:** On startup, `openDatabase()` resets any `pending`/`processing` documents to `failed`.

---

## Bug Cleanup

Bugs to fix in a single cleanup PR. Each item includes the file and the fix.

### 3 — Pressing "Process" on a document resets to idle immediately, appears to do nothing
**File:** `src/ingestion/queue.ts`
**Problem:** `_drain()` shifts the job off the queue and calls `_notify()` with `queue.length = 0` before `await job()`. The `RecordsScreen` listener sees `count === 0`, calls `setProcessingId(null)` (clears the spinner) and `loadData()`. Because `loadData`'s DB read was started before `_processDocument` gets to its first `await _setStatus('processing')` write, it reads `ingestionStatus: 'pending'` — so the UI snaps back to showing the "Process" button. Processing is actually running in the background the whole time; the user just has no visible indicator and presses again thinking it didn't start, queuing a duplicate job.
**Fix:** Make `pendingCount` include the currently-running job (`_running ? 1 : 0`), and have `_notify` report `pendingCount` instead of raw `_queue.length`:
```ts
get pendingCount() {
  return this._queue.length + (this._running ? 1 : 0);
}

private _notify() {
  for (const cb of this._listeners) cb(this.pendingCount); // was: this._queue.length
}
```
Count only reaches 0 after the active job finishes, not the moment it's dequeued.

---

### 2 — Keyboard covers the chat input field
**File:** `app/chat/[id].tsx`
**Problem:** `KeyboardAvoidingView` has a hardcoded `keyboardVerticalOffset={90}`. This value represents the navigation bar height and must match the actual header height on the device. On iPhones with Dynamic Island (and other screen sizes), 90 is wrong — the input field ends up partially hidden behind the keyboard rather than being pushed above it.
**Fix:** Replace the hardcoded offset with `useHeaderHeight()` from `@react-navigation/elements` (available as a transitive dep of Expo Router):
```tsx
import { useHeaderHeight } from '@react-navigation/elements';
// inside component:
const headerHeight = useHeaderHeight();
// on the KAV:
<KeyboardAvoidingView behavior="padding" keyboardVerticalOffset={headerHeight}>
```

---

### 1 — Ingestion `maxTokens` too low — documents fail with truncated JSON
**File:** `src/ingestion/normalizers/fhir.normalizer.ts`
**Problem:** The file-ingestion path passes `maxTokens: 8192` to the LLM. A routine 3-page lab result with ~20 labs can produce 6–8k tokens of FHIR JSON just for the Observation resources, pushing right against the ceiling. When output is truncated, `JSON.parse` throws and the entire document fails to ingest.
**Fix:**
- Raise `maxTokens` to `16384` on the `filePath` branch (line ~152). This immediately helps OpenAI (`gpt-4o-mini` supports 16k output) and gives headroom for Gemini models that support higher limits.
- Change the Anthropic default ingestion model from `claude-3-5-haiku-latest` to `claude-3-5-sonnet-latest` in `KNOWN_GOOD_MODELS`. Haiku is capped at 8192 output tokens at the model level, so raising `maxTokens` alone won't help Anthropic users — a more capable model is needed.
- The `rawText` path's `maxTokens: 4096` can stay as-is; the `MAX_INPUT_CHARS = 12000` input cap naturally bounds the output complexity on that path.

---

## Roadmap

Four independent PRs, each targeting branch `claude/refactor-llm-processing-Fy8w7` (or a fresh branch per PR). Implement in order — PR 1 first, then PR 2, then PR 3 and PR 4 can be done in parallel.

### PR 1 — Remove RAG / vector search
**Branch:** create `feat/remove-rag` from main
**Goal:** Delete all vector-search and FTS infrastructure. The chat already loads every FHIR record as full context via `buildFullContext()` — RAG was never wired into the live app. `fts.service.ts` is already dead code (nothing imports it).

**Changes:**
- Delete `src/rag/rag.service.ts` and its test file
- Delete `src/rag/fts.service.ts` and its test file
- Move `src/rag/context-builder.ts` → `src/llm/context-builder.ts`; update the import in `src/llm/chat.service.ts`
- Delete the `rag/` directory once empty
- `src/db/schema.ts`: remove the `embeddingMetadata` table definition and its exported types
- `src/db/client.ts`: remove the `CREATE TABLE embedding_metadata` block; remove the `CREATE VIRTUAL TABLE fhir_resources_fts` block; remove `indexFhirResourceFts()` and `removeFhirResourceFts()` helpers
- `src/db/repositories/fhir.repository.ts`: remove the `indexFhirResourceFts` call in `upsertFhirResource` and the `removeFhirResourceFts` call in `softDeleteFhirResource`
- `src/ingestion/pipeline.ts`: remove the `embedFhirResource` import and the `search_mode` guard block that calls it
- `src/llm/types.ts`: remove `PROVIDERS_WITH_EMBEDDING_SUPPORT`, `DEFAULT_EMBEDDING_MODELS`, `EMBEDDING_DIMENSIONS`
- `app/(tabs)/settings/index.tsx`: remove the "Search Mode" `SettingsRow` and the `searchMode` state; remove the `getSetting('search_mode')` call
- `src/db/repositories/settings.repository.ts`: remove any `search_mode` / `embedding_model` default handling
- Leave the `search_mode` column in the `chat_sessions` DB table (existing installs have it) — just stop reading/writing it in the app
- Update any tests that referenced the deleted modules

**Definition of done:** `tsc --noEmit` passes; no imports reference `rag/` or `embedding`; Settings screen has no Search Mode row.

---

### PR 2 — Universal file-based LLM document processing + separate ingestion provider setting
**Branch:** create `feat/universal-ingestion` from main (after PR 1 merges)
**Goal:** Send documents directly to the LLM as inline file data for all providers, rather than running a brittle regex PDF text extractor. Add a separate provider/model setting for ingestion vs. chat so users can e.g. use Gemini for document processing and Claude for chat.

**Separate ingestion provider (settings):**
- New settings keys: `ingestion_provider` and `ingestion_model` (stored in `app_settings` alongside existing `active_provider` / `active_model`)
- `app/(tabs)/settings/index.tsx`: add a "Document Processing" row under "AI & Chat" showing `ingestion_provider` · `ingestion_model`. Both "Chat AI" and "Document Processing" rows navigate to the API keys / model picker screen, passing a `role` param (`chat` vs `ingestion`) to determine which settings keys are written
- `src/ingestion/normalizers/fhir.normalizer.ts`: update `resolveProvider()` to read `ingestion_provider` / `ingestion_model`. Fallback chain: if `ingestion_provider` has no configured key, fall back to `active_provider`
- Default for `ingestion_provider` on first launch: auto-select the best available provider (Gemini if key exists, else Anthropic, else OpenAI)

**Universal file attachment:**
- `src/llm/types.ts`: add `fileAttachment?: { base64: string; mimeType: string }` to `ChatCompletionRequest`. Remove the `_pdfBase64` one-off hack.
- Update providers to handle `fileAttachment` in their `complete()` method:
  - **Gemini** (`gemini.provider.ts`): replace `_pdfBase64` with `fileAttachment`; pass as `inline_data` for any `mimeType` (PDF or image)
  - **Anthropic** (`anthropic.provider.ts`): add document/image part to the user message — `type: "document"` for `application/pdf`, `type: "image"` for image types
  - **OpenAI** (`openai.provider.ts`): add `image_url` (base64 data URL) for image types; for `application/pdf` fall back to text extraction with a clear error if text extraction yields nothing ("Use Gemini or Anthropic for scanned PDFs")
  - **Custom** (`custom.provider.ts`): ignore `fileAttachment` silently (custom endpoints vary)
- `src/ingestion/normalizers/fhir.normalizer.ts`:
  - Merge `normalizeTextToFhir` + `normalizePdfToFhir` into a single `normalizeDocumentToFhir(opts: { filePath?: string; mimeType?: string; rawText?: string })` function
  - If `filePath` is present: read as base64, call `provider.complete()` with `fileAttachment`
  - If only `rawText`: call `provider.complete()` with text content as before
- `src/ingestion/pipeline.ts`:
  - Replace the multi-branch text-extraction logic in `_processDocument()` with: if `filePath` present → call `normalizeDocumentToFhir({ filePath, mimeType })`; if `rawText` present → call `normalizeDocumentToFhir({ rawText })`
  - Remove `_extractText()` entirely

**Definition of done:** `tsc --noEmit` passes; uploading a scanned PDF works with Gemini and Anthropic; uploading a JPEG works with all three providers; Settings shows separate Chat AI and Document Processing rows.

---

### PR 3 — Manual FHIR record entry (structured form)
**Branch:** create `feat/manual-record-entry` from main (after PR 2 merges)
**Goal:** Let users add health records without uploading a document, using a type-specific form.

**Entry point:**
- `app/(tabs)/index.tsx`: change the `+` header button to open a bottom sheet (or `ActionSheetIOS`) with three options: "Upload Document" (existing), "Describe in Words" (PR 4), "Fill out Form" (this PR). For now the "Describe in Words" option can be a stub that navigates to a not-yet-implemented screen.

**New screen `app/records/new.tsx`:**
- Step 1: card grid to pick a resource type — Condition, Medication, Allergy, Immunization, Observation, Procedure, Diagnostic Report
- Step 2: type-specific form fields:
  - **Condition**: Name (text), Date, Status picker (active / resolved / inactive), Notes
  - **MedicationStatement**: Drug name, Dose, Frequency, Start date, Status (active / stopped)
  - **AllergyIntolerance**: Allergen, Reaction description, Severity picker (mild / moderate / severe), Date
  - **Immunization**: Vaccine name, Date
  - **Observation**: Test/lab name, Value, Unit, Date
  - **Procedure**: Name, Date, Notes
  - **DiagnosticReport**: Title, Date, Conclusion/summary
- On "Save": serialise form data to a valid FHIR R4 JSON object, call `upsertFhirResource({ resourceType, resourceJson, sourceDocumentId: null, effectiveDate })`
- Navigate back to Records screen on success; show inline validation errors on failure

**Edit support:**
- `app/records/[id].tsx`: if `resource.sourceDocumentId === null`, show an "Edit" button that navigates to `app/records/edit/[id].tsx` (or passes an `edit` param to `new.tsx`)
- Records from documents do not get an Edit button — they are LLM-generated and editing would drift from the source

**Definition of done:** `tsc --noEmit` passes; a Condition, Medication, and Allergy can each be created and edited manually without an API key; records appear in the grouped list immediately after save.

---

### PR 4 — Plain English → FHIR via LLM
**Branch:** create `feat/natural-language-entry` from main (after PR 2 merges; parallel with PR 3)
**Goal:** Let users describe a health record in plain English and have the LLM extract the correct FHIR resource(s), with a review step before saving.

**New screen `app/records/describe.tsx`:**
- Full-screen text area with placeholder: *"e.g. I was diagnosed with Type 2 diabetes in March 2019 and started metformin 500mg twice daily"*
- "Extract Records" button → calls `normalizeDocumentToFhir({ rawText })` using the `ingestion_provider` (from PR 2) — same normalizer, no new LLM logic needed
- Loading state while the LLM processes

**Review step (same screen, step 2):**
- List of extracted FHIR resources rendered as `ResourceCard` components (same component used in the main records list)
- Each card has an `×` to remove it before confirming
- "Save N records" button → loops through confirmed resources, calls `upsertFhirResource()` for each with `sourceDocumentId: null`
- "Start over" link to go back to step 1

**Entry point:**
- Wire up the "Describe in Words" stub from PR 3's bottom sheet to navigate to this screen
- If PR 3 has not shipped yet, add a temporary standalone entry point (e.g. a long-press on the `+` button)

**Definition of done:** `tsc --noEmit` passes; typing "penicillin allergy" extracts an `AllergyIntolerance` resource that appears in the records list after confirmation; multi-resource input ("diabetes and metformin") extracts both a `Condition` and a `MedicationStatement`.
