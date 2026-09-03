# Node.js packaging

Naming: libraries get a `nodejs-` prefix; standalone applications use the plain program name.
Convention: `_pkgname=${pkgname#nodejs-}` recovers the npm package name.

## Canonical PKGBUILD (Node.js CLI tool, npm registry tarball)

```bash
pkgname=nodejs-example-cli
_pkgname=${pkgname#nodejs-}
pkgver=1.2.3
pkgrel=1
pkgdesc="Example command-line tool"
arch=('any')
url="https://github.com/example/example-cli"
license=('MIT')
depends=('nodejs')
makedepends=('npm')
source=("https://registry.npmjs.org/$_pkgname/-/$_pkgname-$pkgver.tgz")
noextract=("$_pkgname-$pkgver.tgz")
sha256sums=('SKIP')

package() {
    npm install -g --cache "$srcdir/npm-cache" --prefix "$pkgdir/usr" \
        "$srcdir/$_pkgname-$pkgver.tgz"

    # Remove $pkgdir references npm embeds in dependency package.json files
    find "$pkgdir" -name package.json -print0 | xargs -r -0 sed -i '/_where/d'

    # Strip all underscored properties from the main package.json
    local tmppackage="$(mktemp)"
    local pkgjson="$pkgdir/usr/lib/node_modules/$_pkgname/package.json"
    jq '.|=with_entries(select(.key|test("_.+")|not))' "$pkgjson" > "$tmppackage"
    mv "$tmppackage" "$pkgjson"
    chmod 644 "$pkgjson"

    # Fix permissions npm leaves behind
    chown -R root:root "$pkgdir"
}
```

- `npm install -g --prefix "$pkgdir/usr"` installs the tarball under
  `"$pkgdir"/usr/lib/node_modules/$_pkgname` and symlinks executables from the
  package's `bin` entries into `"$pkgdir"/usr/bin` automatically — no manual
  symlink needed. Add one only if a needed executable is not declared in `bin`.
- Do not extract the tarball; npm consumes the `.tgz` directly (`noextract`).
- Installing the published tarball this way installs only its runtime
  dependencies, not devDependencies.
- Get exact tarball URLs for scoped/complex specs with
  `npm view @scope/name@1.2.3 dist.tarball`.
- Use SPDX identifiers in `license=()` (e.g. `MIT`, `Apache-2.0`, `GPL-3.0-or-later`).

## npm cache

npm writes its cache to `$HOME/.npm` by default. Always redirect it into the
build dir with `--cache "$srcdir/npm-cache"` on every npm invocation, then
continue packaging as usual (e.g. `npm run packager`).

## $pkgdir / $srcdir references

npm embeds source/package paths into installed files (known npm issue). They
are unused; remove them:

- Dependencies: `_where` attribute in every `package.json` — delete with the
  `find | xargs sed '/_where/d'` line above.
- Main package: all underscored properties — strip with the `jq` snippet above.
- `man` attributes in `package.json` files may also contain `$pkgdir` paths;
  if man pages are not needed, delete the attribute:

```bash
find "$pkgdir" -type f -name package.json | while read pkgjson; do
    local tmppackage="$(mktemp)"
    jq 'del(.man)' "$pkgjson" > "$tmppackage"
    mv "$tmppackage" "$pkgjson"
    chmod 644 "$pkgjson"
done
```

Add `jq` to `makedepends` when using these snippets.

## Pinning a Node version with nvm

Only when building/packaging needs a specific Node version (never a substitute
for the runtime `depends`): `makedepends=('npm' 'nvm')`, isolate `NVM_DIR`
inside `"$srcdir"`:

```bash
_ensure_local_nvm() {
    which nvm >/dev/null 2>&1 && nvm deactivate && nvm unload
    export NVM_DIR="$srcdir/.nvm"
    source /usr/share/nvm/init-nvm.sh || [[ $? != 1 ]]
}

prepare() {
    _ensure_local_nvm
    nvm install 14.15.0
}

build() {
    _ensure_local_nvm
    npm install
}
```

Call `_ensure_local_nvm` before every nvm/npm use. Bare `nvm install` reads the
version from `.nvmrc`.

## Pitfalls

- npm cache lands in the builder's `$HOME/.npm` — pass `--cache "$srcdir/npm-cache"` to every npm call.
- npm embeds `$pkgdir`/`$srcdir` paths in `package.json` files (`_where`, other `_*` keys, `man`) — strip them in `package()`.
- npm-installed files can carry wrong ownership/permissions — `chown -R root:root "$pkgdir"` and fix modes (e.g. `chmod 644` on edited files); namcap flags the rest.
- Bundled `node_modules` ships every dependency's code — verify the licenses of what actually gets packaged, not just the top-level package.
- Version mismatch at build time is a `makedepends`/nvm concern only; runtime still needs `depends=('nodejs')`.
