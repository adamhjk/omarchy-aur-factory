# Rust PKGBUILDs

## Canonical example (source tarball)

```bash
pkgname=hexyl
pkgver=0.14.0
pkgrel=1
pkgdesc="Command-line hex viewer"
arch=(x86_64)
url="https://github.com/sharkdp/hexyl"
license=('MIT OR Apache-2.0')
depends=(gcc-libs glibc)
makedepends=(cargo)
source=("$pkgname-$pkgver.tar.gz::$url/archive/v$pkgver.tar.gz")
sha256sums=('...')

prepare() {
    cd "$srcdir/$pkgname-$pkgver"
    export RUSTUP_TOOLCHAIN=stable
    cargo fetch --locked --target "$(rustc -vV | sed -n 's/host: //p')"
}

build() {
    cd "$srcdir/$pkgname-$pkgver"
    export RUSTUP_TOOLCHAIN=stable
    export CARGO_TARGET_DIR=target
    cargo build --frozen --release --all-features
}

check() {
    cd "$srcdir/$pkgname-$pkgver"
    export RUSTUP_TOOLCHAIN=stable
    cargo test --frozen --all-features
}

package() {
    cd "$srcdir/$pkgname-$pkgver"
    install -Dm0755 -t "$pkgdir/usr/bin/" "target/release/$pkgname"
    install -Dm644 LICENSE-MIT "$pkgdir/usr/share/licenses/$pkgname/LICENSE"
}
```

## Naming and deps

- pkgname: lowercase, usually the binary name. Package only crates that produce binaries, never library crates.
- `depends`: most Rust deps are statically linked; typically just `gcc-libs glibc`, plus any system libraries the build links against.
- `makedepends=(cargo)` always; use `makedepends=(cargo-nightly)` if upstream requires nightly.

## Source

Prefer upstream tarballs/release archives. Fallback to crates.io (note: often lacks tests/license files):

```bash
source=("$pkgname-$pkgver.tar.gz::https://static.crates.io/crates/$pkgname/$pkgname-$pkgver.crate")
```

## prepare()

`cargo fetch --locked --target <host-triple>` downloads all deps so later stages run offline.
`--locked` pins to Cargo.lock (reproducibility); `--target` limits fetching to the build platform.
For a VCS package whose Cargo.lock is stale vs Cargo.toml, run `cargo update` before `cargo fetch`
(build is then not fully reproducible).

## build() / check()

- `cargo build --frozen --release --all-features`
- `--frozen` = `--locked --offline`: use only Cargo.lock versions from the prepare() fetch.
- `--release`: cargo defaults to debug builds.
- `--all-features`, or `--features FEATURE1,FEATURE2` to select.
- `cargo test --frozen --all-features` — do NOT pass `--release` to tests (it disables overflow
  checks and `debug_assert!`, catching fewer bugs; the tested binary isn't the shipped one anyway).
- If root `Cargo.toml` has a `[workspace]` section, add `--workspace` to `cargo test`.

## Exports

In every function that runs cargo:

```bash
export RUSTUP_TOOLCHAIN=stable   # nightly if upstream requires; skip if upstream ships rust-toolchain(.toml)
export CARGO_TARGET_DIR=target   # build() only; forces output into ./target
```

Both guard against user-level config when not building in a clean chroot.

## package()

```bash
install -Dm0755 -t "$pkgdir/usr/bin/" "target/release/$pkgname"
```

Multiple binaries:

```bash
find target/release -maxdepth 1 -executable -type f \
    -exec install -Dm0755 -t "$pkgdir/usr/bin/" {} +
```

`cargo install` variant (only when it's the sole way to install extra assets; it rebuilds, so omit build()):

```bash
cargo install --no-track --frozen --all-features --root "$pkgdir/usr/" --path .
```

`--no-track` is mandatory — otherwise it litters `/usr/.crates.toml` and `/usr/.crates2.json`.

## Unbundling C/C++ libraries (-sys crates)

Find them with `cargo tree --all-features`. Add the system lib to `depends` and export in build():

| Crate          | Depends  | Export |
|----------------|----------|--------|
| jemalloc-sys   | jemalloc | `JEMALLOC_OVERRIDE=/usr/lib/libjemalloc.so` and `CARGO_FEATURE_UNPREFIXED_MALLOC_ON_SUPPORTED_PLATFORMS=1` |
| lcms2-sys      | lcms2    | `LCMS2_LIB_DIR=/usr/lib` |
| libgit2-sys    | libgit2  | `LIBGIT2_NO_VENDOR=1` |
| libsqlite3-sys | sqlite   | `LIBSQLITE3_SYS_USE_PKG_CONFIG=1` |
| libssh2-sys    | libssh2  | `LIBSSH2_SYS_USE_PKG_CONFIG=1` |
| openssl-sys    | openssl  | `OPENSSL_NO_VENDOR=1` |
| zstd-sys       | zstd     | `ZSTD_SYS_USE_PKG_CONFIG=1` |

For other -sys crates: check the crate's Cargo.toml for features forcing static linking (if a reverse
dep enables one, unbundling is impossible), then check its build.rs for controlling env vars.

## Pitfalls

- Rust binaries are arch-specific: `arch` can never be `any`.
- No Cargo.lock upstream: `--locked`/`--frozen` fail; generate one in prepare() or use `cargo update`, and note the build isn't reproducible.
- `--frozen` in build()/check() only works after `cargo fetch --locked` ran in prepare().
- Prefer system libs over vendored ones (e.g. `OPENSSL_NO_VENDOR=1`), and add them to `depends`.
- LTO link errors with GCC: unbundle C/C++ libs first; for cross-language crates (e.g. ring) or mixed Rust/C projects, disable the `lto` option — Rust's own LTO still optimizes the binary.
- crates.io `.crate` tarballs often omit LICENSE/tests; prefer the upstream repo tarball.
- Testing with `--release` hides overflow checks and `debug_assert!` — run tests in debug mode.
