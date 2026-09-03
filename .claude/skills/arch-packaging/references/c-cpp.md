# C/C++ Build Systems for PKGBUILDs

## Detecting the build system

Look at the source tree root:

| File present | Build system |
|---|---|
| `CMakeLists.txt` | CMake |
| `meson.build` | Meson |
| `configure` or `configure.ac` / `autogen.sh` | Autotools |
| `Makefile` only | Plain Makefile |

If both CMake and Meson files exist, prefer whichever upstream documents.
Add the build tool (`cmake`, `meson`, or nothing for autotools/make — `base-devel`
is assumed) to `makedepends`.

## CMake

`makedepends=(cmake)`

```bash
build() {
  local cmake_options=(
    -B build
    -S "$pkgname-$pkgver"
    -W no-dev
    -D CMAKE_BUILD_TYPE=None
    -D CMAKE_INSTALL_PREFIX=/usr
  )
  cmake "${cmake_options[@]}"
  cmake --build build
}

check() {
  ctest --test-dir build --output-on-failure
}

package() {
  DESTDIR="$pkgdir" cmake --install build
}
```

- `check()` works only if upstream uses `enable_testing()`/`add_test()`.
- `-D CMAKE_INSTALL_PREFIX=/usr` is required: CMake defaults to `/usr/local`.
- If libraries land in `/usr/lib64`, add `-D CMAKE_INSTALL_LIBDIR=lib`.
- Build type `None` keeps makepkg's `CFLAGS`/`CXXFLAGS` intact; `Release` injects
  `-O3`, overriding Arch's `-O2`. If upstream sets required flags only for
  `Release` (via `CMAKE_C_FLAGS_RELEASE`/`CMAKE_CXX_FLAGS_RELEASE`), either keep
  `None` and verify nothing essential is lost, or set
  `CMAKE_C_FLAGS='-DNDEBUG'`/`CMAKE_CXX_FLAGS='-DNDEBUG'` to override just `-O3`.
- `None` omits `-DNDEBUG`; this can cause the makepkg warning
  `Package contains reference to $srcdir` — add `-DNDEBUG` via flags if needed.
- Verify flags with `make VERBOSE=1` (or `ninja -v`): confirm `-O2` and
  `-D_FORTIFY_SOURCE=2` appear; the last optimization flag on the line wins.
- Namcap reports insecure RPATH? Try `-D CMAKE_SKIP_INSTALL_RPATH=YES` or
  `-D CMAKE_SKIP_RPATH=YES` (one, not both).
- Upstream uses FetchContent? Add each fetched tarball to `source=()` and pass
  `-D FETCHCONTENT_FULLY_DISCONNECTED=ON`
  `-D FETCHCONTENT_SOURCE_DIR_<UPPERCASENAME>="$srcdir/name"`.
- List all project options: `cmake -LAH` in the source tree.
- CMake ignores `CPPFLAGS` from the environment; if a `-D` preprocessor flag from
  makepkg.conf matters, append it to `CFLAGS`/`CXXFLAGS`.

## Meson

`makedepends=(meson)`

```bash
build() {
  arch-meson "$pkgname-$pkgver" build
  meson compile -C build
}

check() {
  meson test -C build --print-errorlogs
}

package() {
  meson install -C build --destdir "$pkgdir"
}
```

- `arch-meson` is Arch's opinionated wrapper (sets `--prefix=/usr`,
  `--buildtype=plain`, etc.). Without it, use:
  `meson setup --prefix=/usr --buildtype=plain build "$pkgname-$pkgver"`.
  `--prefix=/usr` is mandatory either way.
- Project-specific options live in `meson.options` or `meson_options.txt`;
  pass them as `-D key=value` (e.g. `-D gtk_doc=true`).
- Downloadable subprojects: fetch them offline-safe in
  `prepare() { meson subprojects download --sourcedir="$pkgname-$pkgver"; }`
  (only needed when subprojects aren't just fallbacks for system libs).
- `DESTDIR="$pkgdir" meson install -C build` is an equivalent install form.
- Error `Function does not take positional arguments` (Meson >= 0.60): patch the
  offending `meson.build` (commonly a stray first positional arg to
  `i18n.merge_file()`), and upstream the fix.

## Autotools

```bash
build() {
  cd "$pkgname-$pkgver"
  ./configure --prefix=/usr --sysconfdir=/etc --localstatedir=/var
  make
}

check() {
  cd "$pkgname-$pkgver"
  make check
}

package() {
  cd "$pkgname-$pkgver"
  make DESTDIR="$pkgdir" install
}
```

- Only `configure.ac` present (no `configure` script): run `autoreconf -fiv`
  (or upstream's `./autogen.sh`) in `prepare()`; add `autoconf`/`automake` deps
  if not covered by base-devel.
- Some projects use `make test` instead of `make check`; omit `check()` if no
  test target exists.

## Plain Makefile

Inspect the Makefile first: check whether it honors `PREFIX`/`prefix`,
`DESTDIR`, and whether `install` exists. Typical case:

```bash
build() {
  cd "$pkgname-$pkgver"
  make PREFIX=/usr
}

package() {
  cd "$pkgname-$pkgver"
  make PREFIX=/usr DESTDIR="$pkgdir" install
}
```

- No `DESTDIR` support: patch the Makefile or install files manually with
  `install -Dm755 binary "$pkgdir/usr/bin/binary"` etc.
- Hardcoded `CFLAGS`/`LDFLAGS` in the Makefile clobber makepkg's; override with
  `make CFLAGS="$CFLAGS" LDFLAGS="$LDFLAGS"` or patch to append.

## Pitfalls

- Never use `-DCMAKE_BUILD_TYPE=Release` for packages: its `-O3` overrides Arch's `-O2` — use `None` (only safe if verified upstream hardcodes `-O2` for Release).
- Always set the prefix to `/usr`; CMake, Meson, autotools, and most Makefiles default to `/usr/local`.
- Always install with `DESTDIR="$pkgdir"` (or Meson `--destdir`); never `sudo make install`.
- Build out-of-source (`-B build`, Meson builddir) — keeps `$srcdir` clean and rebuilds sane.
- Ensure makepkg's `CFLAGS`/`CXXFLAGS`/`LDFLAGS` reach the compiler (verify with `VERBOSE=1`/`ninja -v`); patch builds that ignore or overwrite them.
- Delete libtool archives if installed: `rm -f "$pkgdir"/usr/lib/*.la` (or `find "$pkgdir" -name '*.la' -delete`).
- Quote `"$pkgdir"` and `"$srcdir"` everywhere — paths may contain spaces.
- Fix `WARNING: Package contains reference to $srcdir` (often a missing `-DNDEBUG`).
- No network during build: all sources go in `source=()`; disable FetchContent / download Meson subprojects in `prepare()`.
- Run namcap on the built package; fix insecure RPATH findings.
