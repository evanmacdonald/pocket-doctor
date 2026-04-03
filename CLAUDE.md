# Pocket Doctor — Claude Instructions

## Project Overview
Local-first iOS health record app built with Expo (React Native). All data lives on-device in SQLite. Users bring their own LLM API key (OpenAI / Anthropic / Gemini). Zero backend, zero server cost. MIT licensed.

## Tech Stack
- **Framework:** Expo SDK 55, React Native, Expo Router v4 (file-based routing)
- **Language:** TypeScript (strict)
- **Styling:** NativeWind v4 (Tailwind CSS for React Native)
- **Database:** expo-sqlite + drizzle-orm (SQLite on-device)
- **Search:** SQLite FTS5 (keyword), sqlite-vec (RAG embeddings — pre-v1, pinned)
- **LLM:** Direct REST fetch to OpenAI / Anthropic / Gemini — no SDKs (incompatible with Hermes)
- **Secrets:** expo-secure-store (iOS Keychain, WHEN_UNLOCKED_THIS_DEVICE_ONLY)
- **Encryption:** react-native-quick-crypto + react-native-nitro-modules (AES-256-GCM)
- **Build:** `npx expo run:ios` for dev builds (required for Keychain + native modules)

## Key Architecture Rules
- **No backend.** All logic runs on-device. Never add a server, API route, or cloud sync.
- **No LLM SDKs.** Use direct `fetch()` REST calls only — SDKs are incompatible with Hermes.
- **Drizzle schema = source of truth.** Tables are created via `CREATE TABLE IF NOT EXISTS` in `src/db/client.ts` `openDatabase()` — not drizzle-kit migrations.
- **PDF ingestion uses Gemini inline PDF** — binary PDFs are sent as base64 `inline_data` parts, not text-extracted.
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
    rag.service.ts  # sqlite-vec embeddings + ANN search
    fts.service.ts  # FTS5 keyword search
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

## Common Gotchas
- **`npx expo start` vs `npx expo run:ios`:** Keychain (expo-secure-store) and native modules require `run:ios`. Metro alone won't work.
- **Ruby encoding crash in CocoaPods:** Always prefix pod commands with `LANG=en_US.UTF-8 LC_ALL=en_US.UTF-8`.
- **Gemini model names:** Don't hardcode them — call `provider.listModels()` and pick a flash model dynamically.
- **PDF text extraction fails on binary PDFs:** The pipeline falls back to sending raw bytes to Gemini as `inline_data`.
- **expo-file-system v55:** Import from `expo-file-system/legacy` not `expo-file-system`.
- **iOS 26 simulator:** Clipboard paste is broken — type API keys manually or use an iOS 18 simulator.
- **Stuck documents:** On startup, `openDatabase()` resets any `pending`/`processing` documents to `failed`.
