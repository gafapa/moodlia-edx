# Changelog

## Unreleased

### Security — 2026-10-25

- Update development dependencies to Vite 8.3.5 and Vitest/mocker 5.0.5,
  and refresh `source-map-js` to 1.2.2.
- Resolve all npm audit findings in the complete dependency tree and add a CI
  audit gate for moderate or higher findings. Production dependencies are unchanged.
