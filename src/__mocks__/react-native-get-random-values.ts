// No-op mock. This module is imported for its side-effect of polyfilling
// crypto.getRandomValues() on React Native / Hermes.
// In Node 18+, globalThis.crypto.getRandomValues is available natively,
// so no polyfill is needed.
export default {};
