# VCS (git) PKGBUILD reference

Prototype ships at `/usr/share/pacman/PKGBUILD-vcs.proto` (pacman package).

## Canonical -git PKGBUILD

```bash
pkgname=foo-git
pkgver=0.9.9.r27.g2b039da   # placeholder; makepkg runs pkgver() and overwrites it
pkgrel=1
pkgdesc="Foo (git development version)"
arch=('x86_64')
url="https://example.org/foo"
license=('MIT')
depends=()
makedepends=('git')
provides=("foo=${pkgver}")
conflicts=('foo')
source=("$pkgname::git+https://example.org/foo/foo.git#branch=main")
sha256sums=('SKIP')

# Tagged upstream: version from most recent annotated tag.
pkgver() {
  cd "$pkgname"
  git describe --long --abbrev=7 | sed 's/\([^-]*-g\)/r\1/;s/-/./g'
}
# -> 2.0.r6.ga17a017
# Add --tags to also match non-annotated tags. Tag prefix like 'v' or 'foo-':
# prepend 's/^foo-//;' to the sed. Tags without dashes: sed 's/-/.r/;s/-/./'.

# Untagged upstream: commit count + short hash.
# pkgver() {
#   cd "$pkgname"
#   printf "r%s.%s" "$(git rev-list --count HEAD)" "$(git rev-parse --short=7 HEAD)"
# }
# -> r1142.a17a017

# Combined (works before and after upstream's first tag; bashism):
# pkgver() {
#   cd "$pkgname"
#   ( set -o pipefail
#     git describe --long --abbrev=7 2>/dev/null | sed 's/\([^-]*-g\)/r\1/;s/-/./g' ||
#     printf "r%s.%s" "$(git rev-list --count HEAD)" "$(git rev-parse --short=7 HEAD)"
#   )
# }

build() {
  cd "$srcdir/$pkgname"
  make
}

package() {
  cd "$srcdir/$pkgname"
  make DESTDIR="$pkgdir" install
}
```

## Source URL syntax

```bash
source=('[folder::][vcs+]url[#fragment]')
```

- `folder::` — optional local clone name (avoids generic names like `trunk`). Never use `$pkgver` in it: pkgver() changes the variable mid-build.
- `vcs+` — required when the URL doesn't reveal the VCS, e.g. `git+https://...`.
- `#fragment` — pin a ref: `#branch=name`, `#tag=v1.0.0`, `#commit=<hash>` (see PKGBUILD(5) § USING VCS SOURCES for the per-VCS list).
- `?signed` — append to require PGP verification of the tag/commit, e.g. `git+https://...#tag=v1.0.0?signed`.
- makepkg clones into `$SRCDEST` and copies to `"$srcdir"`; the local clone is left untouched. Shallow and sparse clones are not supported.

## Checksums

- VCS sources are not static, so use `'SKIP'` in `sha256sums=()`.
- Exception: a source pinned with `#tag=` or `#commit=` is reproducible — generate a real checksum with `makepkg -g` or `updpkgsums` like any other source.

## Versioning rules

- Format: `RELEASE.rREVISION` (or `rREVISION` / `0.rREVISION` when there are no tags). The `r` delimiter keeps versions monotonic when upstream first tags: `0.1.r456 > r454`, but `0.1.456 < 454`.
- pkgver() runs automatically and updates `pkgver`; still declare `pkgver=` with the latest value. `makepkg --holdver` skips the update.
- Changing deps/URL/sources without a pkgver change: bump `pkgrel` instead.
- Last resort only: `pkgver() { date +%Y%m%d; }` — does not uniquely identify the tree.

## Pinning a tag for non -git packages

Pin the tag to an object hash so a moved tag can't change the build silently:

```bash
_tag=8d17e2e97c04a4e0e3ee6360c009348f6b53e152  # from: git rev-parse v1.0.0 in the repo
source=("$pkgname::git+https://example.org/foo/foo.git#tag=$_tag")
pkgver() { cd "$pkgname"; git describe; }  # verify tag matches pkgver
```

(Verify with a real checksum via `makepkg -g` — see Checksums.)

## Git submodules

Add each submodule repo to `source=()` and rewire it in `prepare()`. The submodule name is whatever `.gitmodules` declares (e.g. `libs/libdep`), not the repo name:

```bash
source=("git+https://example.org/main-project/main-project.git"
        "git+https://example.org/lib-dependency/lib-dependency.git")

prepare() {
  cd main-project
  git submodule init
  git config submodule.libs/libdep.url "$srcdir/lib-dependency"
  git -c protocol.file.allow=always submodule update
}
```

Recursive submodules: after the top-level update, `cd` into the submodule path and repeat (init, config its submodule URL to "$srcdir"/..., update).

Git LFS: add `git-lfs` to makedepends; in prepare() run `git lfs install --local`, `git remote add network-origin <url>`, `git lfs pull network-origin` (use `git -C <path>` for LFS inside submodules).

## Pitfalls

- pkgver may not contain hyphens — the sed in pkgver() converts them to dots.
- Always set `provides=("foo=${pkgver}")` and `conflicts=('foo')` on the base name; avoid `replaces=()`.
- Never put `$pkgver` in the `folder::` field of source.
- Include the VCS tool (`git`, `subversion`, `cvs`, ...) in `makedepends=()`.
- Suffix pkgname with `-git` (`-hg`, `-svn`, ...) only when tracking a branch, not a specific release.
- cvsroot auth: use `anonymous:@host` (or `anonymous:password@`) to avoid a blank-password prompt.
