## Summary

<!-- What does this PR do? 1-3 bullet points. -->

## Testing

- [ ] New `src/` logic has a matching `__tests__/*.test.ts` file in the same directory
- [ ] `npm run test:coverage` passes locally
- [ ] Branch coverage for changed files ≥ 65%

## Mock lookup (for new modules)

| Source imports | Test strategy |
|---|---|
| Pure TypeScript only | No mocks — import and call directly |
| `~/db/client` | `jest.mock('~/db/client', () => require('../../__mocks__/db-client'))` |
| `fetch()` | `global.fetch = jest.fn()` in `beforeEach` |
| `~/llm/provider-registry` | `jest.mock('~/llm/provider-registry')`, inject mock provider |
| `expo-file-system` | Auto-mocked via jest.config.js; override return values per-test |
| `crypto` / backup modules | No mock needed — re-exports Node crypto |
