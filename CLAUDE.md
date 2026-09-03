Read the @README.md.

All swamp commands should be run in the ./swamp subdirectory.

# How work happens here

Both packages and the web app are built through deterministic swamp pipelines that call out to intelligence only where judgment is needed, and every stage writes evidence as versioned swamp data. Prefer running the pipeline over doing its steps by hand; when a stage fails, read its evidence, fix the cause, and re-run the workflow.

## Working on packages

Use the `arch-packaging` skill (it documents the full flow). The pipeline lives on the `packager` model (`@omarchy/arch-package`):

- **New package from a request** (analyze → Claude-authored PKGBUILD → checksums → build → lint → audit):
  `swamp workflow run create-package --input pkgname=<n> --input url=<src> --input "description=..." --input license=<SPDX> --input dir=<abs pkgdir> --input workdir=<abs scratch>`
- **Existing PKGBUILD** (checksums → installdeps → isolated build → vet): `swamp workflow run build-package --input dir=<abs pkgdir> --input name=<pkgname> --input version=<pkgver>-<pkgrel>`
- Builds are isolated with zero setup: a user-namespace overlay (`unshare -r --map-auto`, pivot_root, uid-remapped makepkg) over a cached Arch rootfs at `~/.cache/omarchy-factory/` — the `installdeps` stage pacman-installs the PKGBUILD's deps into the throwaway overlay, so missing host packages never block a build and host packages can't mask undeclared deps. `build` takes `isolated=false` for a bare host build if ever needed.
- **Vet only**: `swamp workflow run vet-package` (same inputs as build-package).
- Evidence keys are `<stage>-<pkgname>-<pkgver>-<pkgrel>`: `swamp data get packager lint-sl-5.02-1`, `buildlog-…`, `pkgbuild-…` (snapshot), `note-<pkgname>-<stage>` (design rationale — record yours with the `note` method after hand-editing a PKGBUILD).
- Each run generates a dossier: `swamp report get @omarchy/package-dossier --workflow <workflow> --markdown` (run-scoped; only the latest survives). The durable per-package dossier is packager data: `swamp data get packager dossier-<pkgname>-<version>` — build-package's `finalize` job stores it on success AND failure.
- Failed build? Read the stage evidence/logs, then retry with maintainer hints: the `create-package` workflow takes an optional `hints` input that is injected into the authoring prompt (the app's retry endpoint records the hint on the request via `record-retry` first).
- Working packages live in `test-packages/`.

## Working on the web app

The app is `app/omarchy-package-request` (Next.js + shadcn; its API routes exec the swamp CLI against `./swamp`). Changes go through the software factory on the `app-factory` model (`@omarchy/app-factory`):

- `swamp workflow run update-app --input appDir=<abs app dir> --input name=wi-<id>-<slug> --input "request=<what to build or change>"`
- Stages: `implement` (Claude call with edit tools + the Next.js/shadcn skills; writes WORK.json), `test` (npm test + build, deterministic), `review` (bounded loop enforced in code: a lower-cost model critiques once, only that critique is fixed, later rounds only verify and flag fix-introduced problems, max 3 rounds).
- Evidence: `swamp data get app-factory implement-wi-…` / `test-wi-…` / `review-wi-…` / `reviewround-wi-…-r1` / `fixround-…`, raw logs in `implementlog-…` etc.
- Make work requests specific: name endpoints, data shapes, and the tests that must pass — the factory is deterministic around the judgment, not a mind reader.
- Hand edits to the app are fine for trivial fixes, but run `npm run test && npm run build` and record what/why with meaningful evidence when the change is substantive (or just route it through `update-app`).

## App data layer

Package requests are swamp data on the `requests` model (`@omarchy/package-request`), one instance per package (`request-<pkgname>`), status `requested → approved → unstable → stable` (or `rejected`). Transition via model methods (`submit`, `approve`, `reject`, `mark-built`, `approve-promotion`) — never by editing data. List with `swamp data query 'name.startsWith("request-") && isLatest' --json`.

The loop is automated end-to-end: the app's approve endpoint fire-and-forgets `create-package`, and the workflow's final (guarded) step calls `mark-built` on success — so an approval alone carries a request to the unstable channel; only promotion approvals remain human.

## Extensions

Local swamp extensions live in `swamp/extensions/` (`models/arch_package.ts`, `models/app_factory.ts`, `models/package_request.ts`, `models/stage_output.ts`, `reports/package_dossier.ts`), collective `@omarchy`, not yet published. Type-check with `~/.swamp/deno/deno check <file>`. Workflow-scope reports only run when a workflow's YAML lists them under `reports.require`.

Child Claude calls report structured output back through swamp, not scratch files: the factory method mints a nonce and gives the child an exact `swamp model @omarchy/stage-output method run record stage-output …` command; the child's payload lands as `record-<kind>-<key>` data (validated JSON at write time) and the parent reads it back, checking the nonce. `--repo-dir` is a per-subcommand flag, not a global one.
