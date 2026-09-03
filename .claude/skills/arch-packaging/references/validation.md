# Validating a Package

The `build-package` swamp workflow runs vetting automatically after the build; `vet-package` runs the same checks standalone (see SKILL.md steps 4–5). Two stages, each writing evidence as swamp data on the `packager` model: **lint** (PKGBUILD parse, shellcheck, namcap, policy checks) and **audit** (built-package file list, metadata, namcap, forbidden paths, $srcdir leakage). This file explains what those stages check and how to fix what they find.

## Tooling

| Tool | Package | Checks |
|---|---|---|
| `shellcheck` | shellcheck | Bash errors in the PKGBUILD |
| `namcap` | namcap | PKGBUILD mistakes + built-package analysis (deps, permissions, file placement) |
| `makepkg --printsrcinfo` | pacman | PKGBUILD parses cleanly; .SRCINFO generation |
| `pacman -Qlp/-Qip` | pacman | File list / metadata inspection |

Install missing tools: `sudo pacman -S --needed namcap shellcheck`.

## shellcheck

```bash
shellcheck --shell=bash --exclude=SC2034,SC2154,SC2164 PKGBUILD
```

Excluded codes are false positives for PKGBUILDs (vars consumed by makepkg, `$pkgdir` defined externally, `cd` guarded by `-e` mode). Everything else is a real bug.

## namcap

Run on **both** artifacts; severity: `E:` must fix, `W:` must understand (fix or justify), `I:` (with `-i`) advisory.

```bash
namcap PKGBUILD
namcap -i *.pkg.tar.zst
```

Common tags and fixes:

| Tag | Fix |
|---|---|
| `dependency-detected-not-included foo` | Add `foo` to `depends` — namcap found an ELF linking against it. |
| `dependency-not-needed foo` | Remove from `depends` (or move to optdepends if it gates a feature). |
| `libdepends-detected-not-included libfoo.so` | Add the soname to `depends`. |
| `missing-license` / `not-a-common-license` | Set SPDX id; install custom/MIT/BSD text to `/usr/share/licenses/$pkgname/`. |
| `file-in-non-standard-dir` | Move to a standard path (see pkgbuild.md filesystem table). |
| `insecure-rpath` | Patch build to drop rpath, or `chrpath -d` in package(). |
| `incorrect-permissions` | `install -Dm644` data, `-Dm755` executables; fix in package(). |
| `elffile-not-in-allowed-dirs` | ELF outside /usr/bin,/usr/lib — usually a misplaced install. |
| `empty-directory usr/src/debug/...` | Add `options=(!debug)` (prebuilt sources). |
| `package-contains-reference-to-srcdir/pkgdir` | Build embedded an absolute path — find with `grep -R "$PWD/src" pkg/`; fix the build, not the symptom. |
| `script-link-detected /usr/bin/python` etc. | Script interpreter must be in depends. |

## Dependency verification (the #1 packaging error)

namcap's ELF scan is the baseline; confirm manually:

```bash
cd pkg/<pkgname>            # the fakeroot tree left by makepkg
find . -type f -exec file {} + | grep ELF          # what got built
ldd path/to/binary                                  # every .so must map to a package in depends
ldd --unused path/to/binary                         # overlinking hints
pacman -Qo /usr/lib/libwhatever.so                  # which package owns a library
```

- Every direct `ldd` library → owning package in `depends` (skip glibc-owned).
- Scripts: check shebangs and `exec`/`subprocess` calls for runtime tools.
- Missing-at-runtime deps don't fail the build — they fail on the user's machine. This is why you can't rely on the build box having things installed.

## File-list sanity

```bash
pacman -Qlp *.pkg.tar.zst
```

Reject if: anything under `/usr/local`, `/bin`, `/sbin`, `/home`, `/tmp`; empty package; `.la` libtool files; docs >50% of size (consider splitting); world-writable files.

```bash
pacman -Qip *.pkg.tar.zst    # verify pkgver/desc/url/licenses/depends render correctly
```

## Runtime smoke test

```bash
sudo pacman -U --noconfirm *.pkg.tar.zst
<binary> --version && <binary> --help
sudo pacman -R --noconfirm <pkgname>     # if the install was only a test
```

A package that builds but crashes on launch is not done. For GUI apps at minimum verify the binary links and starts (`timeout 5 <binary>` under a virtual display if needed).

## Clean-chroot build (gold standard)

A host build silently uses whatever is installed locally; a chroot build proves `depends`/`makedepends` are complete:

```bash
pkgctl build                 # from devtools, in the PKGBUILD dir
```

Use when available (CI/factory); host `makepkg` + namcap is the minimum bar otherwise.
