# PKGBUILD Reference

A PKGBUILD is a Bash script sourced by `makepkg`. Everything must run non-interactively. `bash -e` semantics apply inside functions: any failing command aborts the build.

## Skeleton (field order is the convention — keep it)

```bash
# Maintainer: Name <email>
pkgname=foo
pkgver=1.2.3
pkgrel=1
pkgdesc="Short description, no package name, <80 chars"
arch=(x86_64)          # or (any) for arch-independent content
url="https://example.com/foo"
license=(GPL-3.0-or-later)
depends=(glibc libbar)
makedepends=(cmake)
checkdepends=()
optdepends=('cups: printing support')
provides=()
conflicts=()
backup=()
options=()
install=
source=("$pkgname-$pkgver.tar.gz::https://example.com/foo/archive/v$pkgver.tar.gz")
sha256sums=('...')

prepare() { cd "$pkgname-$pkgver"; }   # patching, one-time source fixes
build()   { cd "$pkgname-$pkgver"; }   # compile
check()   { cd "$pkgname-$pkgver"; }   # upstream test suite
package() { cd "$pkgname-$pkgver"; }   # install into "$pkgdir" ONLY
```

`package()` is the only required function. `makepkg` cd's into `$srcdir` before each function.

## Variables

| Variable | Rules |
|---|---|
| `pkgname` | Lowercase alphanumerics + `@._+-`; no leading hyphen/dot. Match upstream tarball name. No major-version suffix unless parallel-installable versions are needed (gtk2/gtk3 style). |
| `pkgver` | Upstream version verbatim. Letters/digits/periods/underscores only — **no hyphens** (replace with `_`). Date versions in ISO order (`20141030`). Test ordering with `vercmp`. |
| `pkgrel` | Starts at 1 per pkgver; increment on rebuilds of the same version; reset to 1 on new pkgver. |
| `epoch` | Only to fix broken version ordering. Avoid. |
| `pkgdesc` | ≤80 chars; never self-referencing ("Text editor for X11", not "Foo is a text editor..."). |
| `arch` | `(x86_64)` for compiled code, `(any)` for scripts/data/pure Python/fonts. `$CARCH` gives the target at build time. |
| `license` | SPDX identifiers (`GPL-3.0-or-later`, `Apache-2.0`, `MIT`). Combine with SPDX syntax in one quoted string: `'GPL-2.0-or-later OR LGPL-2.1-or-later'`. See Licenses below. |
| `options` | Override makepkg defaults with `!` to negate: `!strip !debug` (prebuilt blobs), `!lto` (LTO breakage), `!makeflags`, `!buildflags`. |
| `backup` | User-editable config files, **relative** paths (`etc/foo.conf`). No wildcards or empty dirs. |
| `install` | Name of a `.install` script (pre/post_install/upgrade/remove functions). Not listed in `source`. |

## Dependencies

- `depends` — needed at runtime. List **all direct** dependencies even if pulled in transitively (transitive deps break). Version constraints allowed: `'foo>=1.8'`, repeat for ranges. Soname form `libfoo.so` gets versioned automatically by makepkg.
- `makedepends` — build-only. **Never list members of `base-devel`** (gcc, make, autoconf, pkgconf, ...) — assumed present. VCS sources need their tool (`git`).
- `checkdepends` — only for `check()`.
- `optdepends` — optional features, always with description: `'sane: scanner support'`. Anything not required for core function goes here, not in depends.
- Build all optional features and depend on them, or explicitly disable the feature at configure time. Never leave a feature to autodetection ("automagic deps").

## Package relations

- `provides=(foo)` / `provides=('foo=1.2.3')` — include the version. Never add `$pkgname` itself.
- `conflicts` — packages that can't coexist. Conflicts match against provides too, so conflicting with `foo` covers everything that provides `foo`. Never add `$pkgname`.
- `replaces` — only for repo-level package renames; for AUR/alternatives use provides+conflicts.
- Alternative builds of `foo` (foo-bin, foo-git) use `provides=(foo)` + `conflicts=(foo)`.

## Sources and integrity

- HTTPS always. No mirror-specific URLs.
- Downloaded filenames must be unique across all packages — rename with `::`:
  `source=("$pkgname-$pkgver.tar.gz::https://github.com/owner/repo/archive/v$pkgver.tar.gz")`
- Local files (patches, .desktop, launcher scripts) sit next to the PKGBUILD and are listed by bare name in `source` with their own checksums.
- Checksums: prefer strongest upstream-published type (`b2 > sha512 > sha256`); default `sha256sums`. Generate with `updpkgsums` (or `makepkg -g`). `SKIP` only for VCS sources.
- Upstream PGP signatures: add the `.sig`/`.asc` to `source` and full uppercase fingerprints to `validpgpkeys=()`. Never remove signature/checksum verification to work around a broken release.
- `noextract=()` — bare filenames from source that bsdtar must not unpack (e.g. `.deb` inner archives handled in `prepare()`).
- Arch-specific variants: `source_x86_64=()` with matching `sha256sums_x86_64=()`.

## Functions

- `prepare()` — patching (`patch -p1 < ../fix.patch`), sed fixes, submodule setup. Runs once after extraction; skipped by `makepkg -e`.
- `pkgver()` — VCS packages only; see `vcs.md`.
- `build()` — configure + compile. Use `--prefix=/usr`, never `/usr/local`.
- `check()` — run upstream tests. Skippable by users via `makepkg --nocheck`; still include it.
- `package()` — everything lands under `"$pkgdir"`. `make DESTDIR="$pkgdir" install`, or manual `install -Dm755 foo "$pkgdir/usr/bin/foo"`. Never `mv` from `$srcdir` (breaks `--repackage`).

## Filesystem layout

`/usr/bin` binaries · `/usr/lib` libraries · `/usr/lib/$pkgname` plugins/private libs (not `/usr/libexec`) · `/usr/include` headers · `/usr/share/man` manpages · `/usr/share/doc/$pkgname` docs · `/usr/share/licenses/$pkgname` licenses · `/etc/$pkgname` config · `/opt/$pkgname` large self-contained apps only. Forbidden in packages: `/bin /sbin /home /srv /tmp /run /var/tmp /dev /proc /sys /mnt /media /root /selinux`.

## Licenses

- SPDX identifier from https://spdx.org/licenses/. Common-license texts ship in the `licenses` package — nothing to install.
- MIT/BSD families and `LicenseRef-<name>` customs: also install the text:
  `install -Dm644 LICENSE -t "$pkgdir/usr/share/licenses/$pkgname/"`

## Scripting rules

- Quote `"$pkgdir"` and `"$srcdir"` everywhere.
- Custom variables/functions must be `_`-prefixed (`_commit=`). Don't call makepkg internals (`msg`, `error`, ...) — use `printf`.
- Keep lines ≲100 chars; no stray empty arrays or commented cruft in the final file.
- `srcdir`/`pkgdir` are absolute; never hardcode `src/` or `pkg/`.

## desktop entries and icons (GUI apps)

```bash
install -Dm644 "$pkgname.desktop" -t "$pkgdir/usr/share/applications/"
install -Dm644 icon.svg "$pkgdir/usr/share/icons/hicolor/scalable/apps/$pkgname.svg"
```

## .SRCINFO

Regenerate after **every** PKGBUILD change (AUR serves stale metadata otherwise):

```bash
makepkg --printsrcinfo > .SRCINFO
```
