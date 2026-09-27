# Legacy-profile catalogue snapshot fixture

Exact bytes of a published `/catalog/v1/` snapshot in the legacy catalogue
profile: snapshot `20260913T121711Z-8f039dc45340` (31 records, 8 shards),
captured on 2026-09-13 from a production deployment. Every part was verified
against the pointer and manifest SHA-256 values and byte lengths when it was
captured.

The fixture is the compatibility baseline for legacy-profile snapshots. Tests
use it to check that the decoders classify it as the legacy profile and do not
manufacture automatic-profile metadata for it, that the producer's serving code
and the frontend Worker serve its bytes and hash chain unchanged, that the
catalogue results model takes its controls from the manifest's profile, that
its records convert into scene objects, and that saved application state
containing a catalogue import from it loads
(`src/data/catalogueProfile.test.ts`, `workers/catalogue/serve.test.ts`,
`workers/frontend/index.test.ts`, `src/ui/catalogueResultsModel.test.ts`,
`src/app/catalogueToScene.test.ts`, `src/state/savedStateCompatibility.test.ts`).

Do not regenerate or edit these files: the hashes in `manifest.json` and
`current.json` cover them.

Orbital data: USSPACECOM / 18th Space Defense Squadron, accessed via
Space-Track.org. See `ATTRIBUTION.md`.
