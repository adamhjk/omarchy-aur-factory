---
name: arch-packaging
description: Build Arch Linux packages end-to-end: analyze a source tree, write a best-practices PKGBUILD, build with makepkg, lint with namcap/shellcheck, and verify the result. Use this skill whenever the user wants to package software for Arch or the AUR, create/edit/review/debug a PKGBUILD, build a .pkg.tar.zst, generate a .SRCINFO, or asks to "make a package" from a repo, tarball, binary release, or URL — even if they don't say "PKGBUILD".
---

# Arch Linux Packaging

Produce a package in this order. Do not skip steps. The deterministic stages run as swamp workflows/methods (swamp commands run from the repo's `./swamp` directory) so every stage leaves a chain of evidence as versioned data on the `packager` model; your judgment fills the gaps between them.

**Full pipeline for a new package request** (analyze → Claude-authored PKGBUILD → checksums → build → lint → audit, one command):

```bash
swamp workflow run create-package \
  --input pkgname=<name> --input url=<source-url> \
  --input "description=<desc>" --input license=<SPDX> \
  --input dir=/abs/path/to/pkgdir --input workdir=/abs/scratch/dir
```

The steps below are the same pipeline run stage-by-stage — use them when packaging hands-on or when a pipeline stage fails and you need to intervene.

## 1. Analyze the source

Run the deterministic analyzer — it downloads, unpacks into a scratch dir (never the package directory), detects the build system, and finds license files:

```bash
swamp model @omarchy/arch-package method run analyze packager \
  --input url=<source-url> --input workdir=/abs/scratch/dir --input name=<pkgname>
swamp data get packager analysis-<pkgname>   # buildSystem, reference, licenses, srcRoot
```

Then apply judgment on top of its evidence: confirm the license mapping (the `spdxGuess` is heuristic — see [SPDX identifiers](#licenses)), pick the latest release tag (prefer tagged tarballs over `-git` HEAD), and read the build manifest/docs for runtime vs build-time dependencies.

Build it once by hand in the scratch directory before writing any PKGBUILD. If it won't build by hand, a PKGBUILD won't fix it.

## 2. Read the matching reference

The analysis evidence names the reference to read (`attributes.reference`). Read `references/pkgbuild.md` (always — variable/function contract, field order, checksum and license rules), plus the one matching the build system:

| Source type | Reference |
|---|---|
| Rust / Cargo | `references/rust.md` |
| Python | `references/python.md` |
| Go | `references/go.md` |
| Node.js | `references/nodejs.md` |
| C/C++ (CMake, Meson, autotools, make) | `references/c-cpp.md` |
| Prebuilt binary / non-free / Electron | `references/binary.md` |
| VCS (-git) package, or pinning git tags | `references/vcs.md` |

## 3. Write the PKGBUILD

One directory per package containing only `PKGBUILD` plus files shipped alongside it (patches, .install, desktop files). Follow the reference's canonical template. Non-negotiables:

- Fields in conventional order: `pkgname pkgver pkgrel pkgdesc arch url license depends makedepends checkdepends optdepends provides conflicts source sha256sums`, then `prepare() build() check() package()`.
- Real checksums (`updpkgsums` fills them), never `SKIP` except for VCS sources.
- `package()` installs only under `"$pkgdir"` with standard paths (`/usr/bin`, `/usr/lib`, `/usr/share/...`) — never `/usr/local`, never bare `/bin`. Quote `"$pkgdir"` and `"$srcdir"` always.
- No new global variables/functions unless prefixed with `_`.
- Include `check()` running the upstream test suite unless genuinely impossible; if omitted, comment why.
- `makepkg` runs non-interactively; anything interactive (prompts, `sudo`, network in build()) is a bug.
- Checksums: write `sha256sums=('SKIP')` placeholders — the pipeline's checksums stage replaces them with real values (`updpkgsums`). Real `SKIP` survives only for VCS sources.

After writing the PKGBUILD, record your design rationale as evidence — it becomes part of the package's dossier:

```bash
swamp model @omarchy/arch-package method run note packager \
  --input name=<pkgname>-<pkgver>-<pkgrel> --input stage=pkgbuild \
  --input "notes=<why these deps, how the license was mapped, any deviations>"
```

## 4. Build and vet

Run the deterministic build pipeline — checksums (`updpkgsums` + `.SRCINFO`), `makepkg -f` with full log capture and PKGBUILD/.SRCINFO snapshots, then lint + audit, each gated by asserts:

```bash
swamp workflow run build-package \
  --input dir=/abs/path/to/pkgdir \
  --input name=<pkgname> \
  --input version=<pkgver>-<pkgrel>
```

When a stage fails, read its evidence, fix the PKGBUILD, and re-run the workflow. For tight debug loops the manual equivalents are `makepkg -o` (fetch/extract once) then `makepkg -ef` (rebuild without re-downloading); never run makepkg as root. `vet-package` also runs standalone with the same inputs when you only changed metadata.

## 5. Read the evidence

All evidence persists as versioned swamp data on the `packager` model (`@omarchy/arch-package`), keyed per package release:

```bash
swamp data get packager analysis-<name>              # build system, licenses, source layout
swamp data get packager author-<name>                # authored version, deps, rationale (pipeline runs)
swamp data get packager checksums-<name>-<version>   # updpkgsums + .SRCINFO result
swamp data get packager build-<name>-<version>       # exit code, duration, artifacts
swamp data get packager lint-<name>-<version>        # structured lint findings
swamp data get packager audit-<name>-<version>       # structured audit findings
swamp data get packager buildlog-<name>-<version>    # raw makepkg output (lintlog-/auditlog- likewise)
swamp data get packager pkgbuild-<name>-<version>    # PKGBUILD snapshot at build time
swamp data get packager note-<name>-<stage>          # recorded design rationale
```

Fix every `fail`-level check and understand every `warn` before shipping. `references/validation.md` explains each check, the dependency-verification procedure (ldd against the built ELFs), and common namcap tags with fixes.

Every pipeline run also generates a **package dossier** — the full chain of evidence (analysis, authoring rationale, checksums, build, lint, audit, notes, PKGBUILD snapshot) as one document:

```bash
swamp report get @omarchy/package-dossier --workflow create-package --markdown   # or build-package / vet-package
```

## 6. Verify

- `pacman -Qlp *.pkg.tar.zst` — file list sane, license installed for custom/MIT/BSD licenses.
- `pacman -Qip *.pkg.tar.zst` — metadata sane.
- Install with `pacman -U` and run the binary (at minimum `--version`/`--help`).
- For AUR publication: `makepkg --printsrcinfo > .SRCINFO` and keep it in sync with every PKGBUILD change.
