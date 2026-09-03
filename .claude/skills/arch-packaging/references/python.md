# Python packaging (PEP 517)

## Canonical PKGBUILD (modern pyproject.toml project)

```bash
_name=example
pkgname=python-example
pkgver=1.2.3
pkgrel=1
pkgdesc="Example Python library"
arch=(any)
url="https://github.com/upstream/example"
license=(MIT)
depends=(python python-requests)
makedepends=(python-build python-installer python-wheel python-setuptools)
checkdepends=(python-pytest)
source=("$url/archive/v$pkgver/$_name-$pkgver.tar.gz")
sha256sums=('...')

build() {
    cd "$_name-$pkgver"
    python -m build --wheel --no-isolation
}

check() {
    cd "$_name-$pkgver"
    pytest
}

package() {
    cd "$_name-$pkgver"
    python -m installer --destdir="$pkgdir" dist/*.whl
}
```

- `--no-isolation`: build against system packages (your depends/makedepends), not a venv.
- `--destdir="$pkgdir"`: install into the package, not the host system.
- Add the project's PEP 517 build backend to `makedepends` (read `build-system.build-backend`
  in `pyproject.toml`; default is `python-setuptools`). Repo backends are in the
  `python-build-backend` group.

## Naming

- Library modules: `python-<modulename>`, entirely lowercase. Also use the prefix for
  programs strongly coupled to the Python ecosystem (pip, tox). Plain applications: just
  the program name.
- Define `_name=${pkgname#python-}` for use in source URLs and directories.

## Architecture

- Pure Python: `arch=(any)`. Contains C extensions (setuptools `ext_modules` in setup.py):
  architecture-dependent, e.g. `arch=(x86_64)`.

## Source

- Prefer upstream-provided source tarballs (e.g. GitHub release/tag) over PyPI sdists (RFC0020).
- PyPI web download URLs contain unpredictable hashes — never use them. If you must use PyPI,
  use the stable scheme:
  `https://files.pythonhosted.org/packages/source/${_name::1}/${_name//-/_}/${_name//-/_}-$pkgver.tar.gz`
- Dashes in the distribution name become underscores in sdist/wheel filenames.
- Shipping a `.whl` in `source=()` and skipping build() is discouraged; only for wheel-only
  upstreams.

## Dependencies

- Runtime deps from the project metadata must be listed in `depends` as `python-*` packages
  (plus `python` itself) — installer does not pull them in.
- If the backend derives the version from git (building from a tarball fails with a version
  LookupError), export the matching variable in build():
  - setuptools-scm / flit-core / hatch-vcs: `export SETUPTOOLS_SCM_PRETEND_VERSION=$pkgver`
  - pbr: `export PBR_VERSION=$pkgver`
  - pdm-backend: `export PDM_BUILD_SCM_VERSION=$pkgver`

## check()

- Run the real testsuite: `pytest`, `python -m unittest discover -v .`, or `nosetests`.
  Put the runner in `checkdepends` (e.g. `python-pytest`).
- Disable pytest addopts (coverage/lint plugins break packaging builds): `pytest -o addopts=""`.
  Do not add lint/coverage/type-check plugins to `checkdepends`.
- Never use tox — it tests PyPI downloads, not what you package.
- C extensions: point PYTHONPATH at the build dir (absolute path):

```bash
local python_version=$(python -c 'import sys; print("".join(map(str, sys.version_info[:2])))')
PYTHONPATH="$PWD/build/lib.linux-$CARCH-cpython-$python_version" pytest
```

- Package must be installed for tests to pass? Use a venv against the built wheel:

```bash
python -m venv --system-site-packages test-env
test-env/bin/python -m installer dist/*.whl
test-env/bin/python -P -m pytest
```

## Legacy setuptools fallback (no [build-system] in pyproject.toml)

Prefer the PEP 517 method above even for setup.py projects (add `python-setuptools` to
makedepends). Only if that fails, use the deprecated direct invocation:

```bash
makedepends=(python-setuptools)

build() {
    cd "$_name-$pkgver"
    python setup.py build
}

package() {
    cd "$_name-$pkgver"
    python setup.py install --root="$pkgdir" --optimize=1 --skip-build
}
```

## Tips

- Need the Python version or site-packages path? Never hardcode:
  `python -c 'import sys; print(".".join(map(str, sys.version_info[:2])))'`
  `python -c "import site; print(site.getsitepackages()[0])"`
- meson-python backend: pass `-Cbuild-dir=build` to `python -m build` for reproducibility.
- VCS packages (`python-…-git`): run `git -C "$srcdir/$pkgname" clean -dfx` in prepare()
  to remove stale wheels.

## Pitfalls

- Never pip install into "$pkgdir" — use python-installer (or setup.py install --root).
- Never install directly to the host system: always `--destdir="$pkgdir"` / `--root="$pkgdir"`.
- Do not vendor dependencies; declare them as python-* packages in depends.
- Do not let a top-level `tests/` directory land in site-packages — it conflicts across packages.
- `arch=(any)` only for pure Python; C extensions make the package architecture-dependent.
- Test runners belong in checkdepends, not depends.
- No relative paths in PYTHONPATH — absolute only.
