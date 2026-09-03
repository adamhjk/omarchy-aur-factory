# Prebuilt binaries, non-free apps, Electron

## Canonical -bin PKGBUILD (upstream .deb release)

```bash
pkgname=foo-bin
pkgver=1.2.3
pkgrel=1
pkgdesc="Foo, prebuilt binary release"
arch=(x86_64)
url="https://example.com/foo"
license=(LicenseRef-Foo-EULA)   # SPDX id (e.g. MIT) if upstream uses one
depends=(glibc gtk3)            # verify with ldd/namcap against the shipped ELF files
provides=(foo)
conflicts=(foo)
options=(!strip !debug)         # do not strip or debug-split prebuilt blobs
source=("$pkgname-$pkgver.deb::https://example.com/releases/foo_${pkgver}_amd64.deb")
sha256sums=('...')

package() {
  # makepkg extracts the .deb (an ar archive) into "$srcdir"; unpack the payload:
  bsdtar -xf "$srcdir"/data.tar.xz -C "$pkgdir"

  # For a plain tarball release instead, install files explicitly:
  # install -Dm755 "$srcdir"/foo-$pkgver/foo "$pkgdir"/usr/bin/foo
  # install -Dm644 "$srcdir"/foo-$pkgver/foo.desktop "$pkgdir"/usr/share/applications/foo.desktop
  # install -Dm644 "$srcdir"/foo-$pkgver/foo.png "$pkgdir"/usr/share/icons/hicolor/256x256/apps/foo.png

  install -Dm644 "$srcdir"/foo-$pkgver/LICENSE \
    "$pkgdir"/usr/share/licenses/$pkgname/LICENSE
}
```

## Naming

- Search the AUR first; follow existing naming conventions for similar packages.
- Use the `-bin` suffix only when a source build is possible (or plausible): `foo-bin` implies a buildable `foo` could exist in the AUR/repos.
- Non-free software with no sources available at all gets a plain name, no `-bin` suffix.
- If upstream later opens the sources, the binary package maintainer orphans the plain name to the source package and resubmits as `-bin`.

## License handling (non-free)

- Use an SPDX identifier when one applies; otherwise a `LicenseRef-` custom identifier, e.g. `license=(LicenseRef-Foo-EULA)`.
- Install the EULA/license text into `/usr/share/licenses/$pkgname/` with `install -Dm644`. Extract it from the archive/installer if not shipped separately.

## Restricted or missing downloads

- If the file cannot be fetched by URL (login walls, purchased installers), add it to `source` with a rename so the AUR web link differs from files in the source tarball: `source=(... "$originalname::local://$originalname")`. With `local://`, makepkg expects the file next to the PKGBUILD; pin an AUR comment ("Need archive/installer to work") and explain in the PKGBUILD.
- `file://` scheme allows a custom DLAGENT for the file protocol.
- Files on optical media, or obtainable several ways: use an installer script plus `.install` file; do not download or prompt interactively during `build()`.

### Custom DLAGENTS

For hosts that ban user agents or use temporary links, override the download agent in the PKGBUILD:

```bash
DLAGENTS=("http::/usr/bin/curl -A 'Mozilla' -fLC - --retry 3 --retry-delay 3 -o %o %u")
```

- The agent string must not contain spaces/parentheses/slashes inside quoted values (e.g. a full browser UA) — bash array parsing in makepkg breaks; keep it short (`'Mozilla'`).
- `DLAGENTS=("http::/usr/bin/wget -r -np -nd -H %u")` can follow a download page to a temporary link; or replicate the link-generating HTTP request with curl.
- A DLAGENT can also just print a helpful error telling the user where to get a missing file.

## Unpacking installers

- `bsdtar` (libarchive, always present): extracts `.iso`, `.deb`; `bsdunzip -O` for non-UTF-8 zips.
- `.AppImage`: run with `--appimage-extract`.
- `7zip`: many formats, NSIS `.exe` installers, even single PE sections; `innoextract` for Inno Setup `.exe` (GOG); `cabextract` for `.cab`; `unshield` for InstallShield; `unzip`/`unrar` for SFX archives; `upx -d` for packed executables. Identify with `file`.

## Desktop file and icon

- Install a `.desktop` file to `/usr/share/applications/` and an icon to `/usr/share/icons/hicolor/<size>/apps/` (or `/usr/share/pixmaps/`), `install -Dm644`.
- No icon shipped? Extract from a Windows executable: `wrestool -x --output=icon.ico -t14 executable.exe` (icoutils), then convert.

## Versionless download URLs

When the URL has no version (`.../NonFreeApp.exe`), auto-bump with a `pkgver()` function:

```bash
# from a .deb control file
makedepends=(dpkg)
pkgver() {
  dpkg-deb --show --showformat='${Version}' nonfree-app-latest.deb | tr - .
}
# from a PE installer/executable: peres -v -f csv file.exe | awk -F, '/^Product Version,/ {print $2}'
# (makedepends=(readpe); extract nested exe with 7z in prepare() if needed)
```

## Electron apps

Only `resources/app/` (or `resources/app.asar`) is the application; the rest of a prebuilt distribution is a bundled copy of the Electron runtime and can be deleted when using system electron.

**System electron (preferred):** depend on a versioned `electronNN` package (or the `electron` metapackage for latest) and install a launcher:

```bash
#!/bin/sh
exec /usr/bin/electron34 /usr/lib/appname/ "$@"    # or path to appname.asar
```

- Apps needing `ELECTRON_RUN_AS_NODE=1` (e.g. VS Code) cannot use `/usr/bin/electron*`.
- Find the required electron version with `npm pkg get devDependencies.electron` next to package.json. If hidden (prebuilt/non-free), last resort: swap `app`/`app.asar` for `/usr/lib/electron/resources/default_app.asar` and run the bundled binary with `--version` — but not inside the PKGBUILD.
- Don't `sed` the electron version in package.json; use `npm pkg set devDependencies.electron=$(cat /usr/lib/electron*/version)`.
- Native extensions must be compiled against the system electron version: either patch package.json to that version, or remove the dep and set `npm_config_target=$(cat /usr/lib/electron/version)`, `npm_config_runtime=electron`, `npm_config_arch=x64`, `npm_config_target_arch=x64`, `npm_config_build_from_source=true`, and `HOME="$srcdir/.electron-gyp"` before `npm install` (keep HOME inside "$srcdir").
- electron-builder: set `electronDist` (e.g. `/usr/lib/electron34`) and `electronVersion` (contents of `/usr/lib/electron34/version`, no leading `v`) in its config, or pass `-c.electronDist=... -c.electronVersion=...` on the CLI (both required).

**Architecture and layout:**
- Compiled native extensions → architecture-dependent, `arch=(x86_64)`, install app to `/usr/lib/appname/`.
- Pure JS → likely `arch=(any)`, install to `/usr/share/appname/`.
- Bundled prebuilt electron → always architecture-dependent; copy the whole distribution to `/opt/appname` and add a `/usr/bin` launcher.

## Pitfalls

- Run `ldd`/`namcap` on shipped ELF binaries; add every reported library to `depends` — prebuilt blobs won't tell makepkg what they need.
- Keep `options=(!strip !debug)` on prebuilt binaries: stripping can break signed/packed executables and debug-splitting is pointless.
- Rename generically-named sources with `name::url` so cached files are unique per package/version.
- Prefer `/usr/lib` / `/usr/share` file placement; `/opt/$pkgname` only for large self-contained distributions (e.g. bundled Electron); never make package dirs group-writable to work around apps writing into their install dir.
- Always quote "$pkgdir" and "$srcdir".
- Don't download files or prompt the user inside `build()`; use `local://` sources or an install script.
- Non-free with no obtainable sources: no `-bin` suffix.
- Packaging against system electron discards electron-builder fuse settings; some may need emulating via env vars in the launcher.
- If packaging is harder than just using the upstream installer, keep it simple — or package an open-source variant instead.
