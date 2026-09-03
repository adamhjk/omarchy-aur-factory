# Omarchy AUR Factory

This is a research spike of an Omarchy AUR factory. The goal is:

1) A user submits a request for a package, which results in a packaging request
2) A maintainer approves the request
3) A software factory creates the new package, lints, tests, and builds it
4) The software factory records the package is complete and publishes it to an unstable channel
5) A maintainer and a user both approve the package is working
6) The package is move to a stable channel

# Implementation

## Request Submission, new package maintainer approval, and unstable->stable promotion

A simple typescript web application that takes the minimal amount of information required to package the software - a package name, the URL, a description, and a license.

Lives in app/omarchy-package-request.

Written in next.js with shadcn for the interface.

Split into three views - one for submission, one for maintainer approval, and one for unstable/stable promotion. 

Maintainer approval is a queue that sorts to a category.

Unstable->stable promotion takes a maintainer and a user approval.

Writes the package request and all approval as data into the swamp repo at ./swamp

### Workflow Visualization

When the packaging workflow is running, it should visualize it for the user.

## Software Factory

Built as a swamp extension, whose workflow is 

### New Packages

- Takes in the structured new package request
- Creates a new packaging directory
- Downloads the source and unpacks it into a scratch sub-directory
- Examines the source code to determine the build process and dependencies
- Writes a PKGBUILD file according to best practices
- Vets the PKGBUILD file according to all available linters, etc.
- Makes a build
- Ensures the linking of the build has no errors, and that all dependencies are correctly specified
- Publishes the build to an unstable channel

### Publishing pipeline

When the approvals are met for unstable->stable promotion, moves the package to the stable repository.

### Updating Packages

For now, this is unimplemented. But the idea is that you would check every package for new releases on an interval.



# New box bootstrap

All you need is [swamp](https://github.com/swamp-club/swamp) (and `git`):

```
git clone <this repo> && cd omarchy-aur-factory/swamp
swamp model @omarchy/factory-setup method run converge setup
```

`converge` is idempotent: it bootstraps the isolated build rootfs (user
namespaces — no sudo, no containers to install), installs the web app's
dependencies, and probes every prerequisite with real operations. Anything it
cannot fix without privileges (base-devel, pacman-contrib, nodejs/npm, the
claude CLI, a missing /etc/subuid entry) is reported as `missing` with the
exact remediation command. Re-run until it reports `passed` with nothing
missing; `--input deep=true` additionally builds and vets the seed package
end-to-end. Evidence: `swamp data get setup setup`.

# Example inputs

## Package requests (via the web app's Submit tab, or the CLI)

Known-good starters, each proven through this factory:

| pkgname | url | description | license |
|---|---|---|---|
| figlet | https://github.com/cmatsuoka/figlet/archive/refs/tags/2.2.5.tar.gz | Program for making large letters out of ordinary text | BSD-3-Clause |
| entr | https://github.com/eradman/entr/archive/refs/tags/5.8.tar.gz | Run arbitrary commands when files change | ISC |
| shellharden | https://github.com/anordal/shellharden/archive/refs/tags/v4.3.2.tar.gz | Shell script hardening tool (Rust) | MPL-2.0 |
| htop | https://github.com/htop-dev/htop/archive/refs/tags/3.5.3.tar.gz | Interactive process viewer | GPL-2.0-only |

Full pipeline from the CLI (what the app's approve button runs):

```
swamp workflow run create-package \
  --input pkgname=figlet \
  --input url=https://github.com/cmatsuoka/figlet/archive/refs/tags/2.2.5.tar.gz \
  --input "description=Program for making large letters out of ordinary text" \
  --input license=BSD-3-Clause \
  --input dir=$PWD/../test-packages/figlet \
  --input workdir=/tmp/omarchy-factory-scratch/figlet
```

Rebuild/vet an existing PKGBUILD:

```
swamp workflow run build-package \
  --input dir=$PWD/../test-packages/figlet --input name=figlet --input version=2.2.5-1
```

## Retry a failed build with maintainer hints

Add `--input "hints=..."` to a `create-package` run (the app's Retry button does
this). Real hints that worked, in escalating precision:

- "check() fails: the http networking test simulates connection resets and is
  unreliable under makepkg — exclude that one test file, keep the rest of check()."
- "Root cause confirmed: the test stub hardcodes /usr/bin/deno as a path that
  must not exist; patch it to /nonexistent/deno in prepare() and note the
  upstream bug."

## App work requests (software factory)

```
swamp workflow run update-app \
  --input appDir=$PWD/../app/omarchy-package-request \
  --input name=wi-010-example \
  --input "request=Add a package-count Badge to each tab label (e.g. 'Approval queue (3)'), derived from the already-fetched request list. No API changes. npm run test, typecheck and build must pass."
```

Be specific: name endpoints, data shapes, and the tests that must pass.

# Cautions

- Arch Linux only (makepkg/pacman are load-bearing). You need an authenticated
  `claude` CLI.
- PKGBUILDs are model-authored: read the dossier before you promote — that is
  what the maintainer/user promotion gates are for.
- The web app has no authentication and its API executes swamp commands: bind it
  to localhost or a trusted tailnet only.
