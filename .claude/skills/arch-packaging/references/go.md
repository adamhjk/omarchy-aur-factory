# Go PKGBUILDs

Canonical PKGBUILD for a Go program from a source tarball:

```bash
pkgname=foo
pkgver=0.0.1
pkgrel=1
pkgdesc='Example Go program'
arch=('x86_64')
url="https://example.org/$pkgname"
license=('GPL-3.0-or-later')
makedepends=('go')
source=("$url/$pkgname-$pkgver.tar.gz")
sha256sums=('1337deadbeef')

prepare() {
  cd "$pkgname-$pkgver"
  mkdir -p build/
}

build() {
  cd "$pkgname-$pkgver"
  export CGO_CPPFLAGS="${CPPFLAGS}"
  export CGO_CFLAGS="${CFLAGS}"
  export CGO_CXXFLAGS="${CXXFLAGS}"
  export CGO_LDFLAGS="${LDFLAGS}"
  export GOPATH="${srcdir}"
  export GOFLAGS="-buildmode=pie -trimpath -ldflags=-linkmode=external -mod=readonly -modcacherw"
  go build -o build ./cmd/...
}

check() {
  cd "$pkgname-$pkgver"
  go test ./...
}

package() {
  cd "$pkgname-$pkgver"
  install -Dm755 build/$pkgname "$pkgdir"/usr/bin/$pkgname
}
```

## Naming

- Name the package after the program; use `go-modulename` only if it is strongly coupled to the Go ecosystem.
- Package names must be entirely lowercase.

## Flags

Go ignores system CFLAGS/LDFLAGS; export the CGO_* variables so hardening flags reach the C toolchain. Flag meaning:

- `-buildmode=pie` — PIE hardening.
- `-trimpath` — reproducible builds; no build/module paths embedded in the binary.
- `-mod=readonly` — module files are never modified by go actions.
- `-modcacherw` — module cache written world-writable instead of read-only (not essential, but lets makepkg clean up).
- `-ldflags=-linkmode=external` — use the external linker (embeds a build-id; the internal linker does not).

If sources ship a `vendor/` directory with `modules.txt`, change `-mod=readonly` to `-mod=vendor`.

## Building

- `go build -o output-binary .` builds a single binary.
- `./cmd/...` (`...` = recurse) with `-o build` builds every binary into the `build/` directory; `mkdir -p build/` in `prepare()` first.
- Set `GOPATH="${srcdir}"` and run `go mod download -modcacherw` in `prepare()` to keep modules inside the build environment instead of growing `~/go`.
- Upstream without go modules: in `prepare()`, run `go mod init "${url#https://}"` then `go mod tidy` (makes the build unreproducible — file an issue upstream).

## Debug packages

To produce usable debug packages, adjust the defaults:

- Drop `-trimpath` so source paths stay in the binary.
- Add `-compressdwarf=false` to `-ldflags` (tooling cannot parse compressed DWARF).
- Keep `-linkmode=external` for the build-id.
- Keep `GOPATH="${srcdir}"` so makepkg can include module sources.

```bash
export GOPATH="${srcdir}"
export GOFLAGS="-buildmode=pie -mod=readonly -modcacherw"
go build -ldflags "-compressdwarf=false -linkmode external" .
```

## Pitfalls

- Most upstream Makefiles overwrite `GOFLAGS`: patch the Makefile to respect the flags above or bypass it and invoke `go build` directly.
- Without `-modcacherw` the module cache is read-only and makepkg cannot clean it.
- Verify flags actually reach the compiler — read the Makefile if there is one.
- `go mod init`/`go mod tidy` hacks fetch modules at build time, so the package is unreproducible across builds.
- Without `GOPATH="${srcdir}"` module downloads land in the user's `~/go`.
- Quote `"$pkgdir"` and `"$srcdir"` everywhere.
