/**
 * Arch Linux package pipeline model.
 *
 * Deterministic stages of Arch packaging, each writing evidence as versioned
 * data: `analyze` (fetch + unpack sources, detect build system, find
 * licenses), `checksums` (updpkgsums + .SRCINFO), `build` (makepkg with full
 * log capture), `lint` (PKGBUILD static checks), `audit` (built-package
 * checks). Methods do NOT throw on domain findings — a failing build or lint
 * is a successful stage that found problems; workflows assert on
 * `attributes.passed`. Methods throw only on caller errors (missing dir,
 * missing PKGBUILD).
 *
 * Evidence keying: pass `name` as `<pkgname>-<pkgver>-<pkgrel>` (e.g.
 * sl-5.02-1) so evidence is addressable per package release; re-runs of the
 * same release version-stack under one instance.
 *
 * @module
 */
// extensions/models/arch_package.ts
import { z } from "npm:zod@4";

const GlobalArgsSchema = z.object({});
type GlobalArgs = z.infer<typeof GlobalArgsSchema>;

const CheckSchema = z.object({
  name: z.string(),
  level: z.enum(["pass", "warn", "fail"]),
  detail: z.string(),
});

const LicenseFileSchema = z.object({
  path: z.string(),
  spdxGuess: z.string(),
  snippet: z.string(),
});

const AnalysisSchema = z.object({
  name: z.string(),
  url: z.string(),
  srcRoot: z.string(),
  buildSystem: z.string(),
  buildSystems: z.array(z.string()),
  reference: z.string(),
  licenseFiles: z.array(LicenseFileSchema),
  topLevelFiles: z.array(z.string()),
  hasTests: z.boolean(),
  passed: z.boolean(),
  timestamp: z.iso.datetime(),
});

const InstalldepsSchema = z.object({
  name: z.string(),
  dir: z.string(),
  deps: z.array(z.string()),
  rootfsBootstrapped: z.boolean(),
  passed: z.boolean(),
  timestamp: z.iso.datetime(),
});

const ChecksumsSchema = z.object({
  name: z.string(),
  dir: z.string(),
  updated: z.boolean(),
  srcinfoWritten: z.boolean(),
  passed: z.boolean(),
  timestamp: z.iso.datetime(),
});

const BuildSchema = z.object({
  name: z.string(),
  dir: z.string(),
  exitCode: z.number(),
  durationMs: z.number(),
  artifacts: z.array(z.string()),
  srcinfoWritten: z.boolean(),
  passed: z.boolean(),
  timestamp: z.iso.datetime(),
});

const LintSchema = z.object({
  name: z.string(),
  dir: z.string(),
  pkgname: z.string(),
  pkgver: z.string(),
  parseOk: z.boolean(),
  shellcheckAvailable: z.boolean(),
  namcapAvailable: z.boolean(),
  checks: z.array(CheckSchema),
  failCount: z.number(),
  warnCount: z.number(),
  passed: z.boolean(),
  timestamp: z.iso.datetime(),
});

const AuditSchema = z.object({
  name: z.string(),
  dir: z.string(),
  packageFile: z.string(),
  fileCount: z.number(),
  namcapAvailable: z.boolean(),
  checks: z.array(CheckSchema),
  failCount: z.number(),
  warnCount: z.number(),
  passed: z.boolean(),
  timestamp: z.iso.datetime(),
});

const NoteSchema = z.object({
  name: z.string(),
  stage: z.string(),
  notes: z.string(),
  timestamp: z.iso.datetime(),
});

const NoteArgsSchema = z.object({
  name: z.string().describe("Evidence key: <pkgname>-<pkgver>-<pkgrel>"),
  stage: z.string().describe(
    "Design stage the notes cover: analysis | pkgbuild | dependencies | license | build | other",
  ),
  notes: z.string().describe(
    "Design rationale in plain text/markdown: what was decided and why (deps chosen, license mapping, deviations from templates)",
  ),
});
type NoteArgs = z.infer<typeof NoteArgsSchema>;

const DirArgsSchema = z.object({
  dir: z.string().describe("Absolute path to the directory containing the PKGBUILD"),
  name: z.string().describe(
    "Evidence key: <pkgname>-<pkgver>-<pkgrel> (e.g. sl-5.02-1). Re-runs of the same release version-stack under one instance",
  ),
});
type DirArgs = z.infer<typeof DirArgsSchema>;

const AnalyzeArgsSchema = z.object({
  url: z.string().describe(
    "Source URL: https tarball/zip, or git URL (git+https://... or *.git) cloned at depth 1",
  ),
  workdir: z.string().describe(
    "Absolute scratch directory to download and unpack into (created if missing)",
  ),
  name: z.string().describe(
    "Evidence key, best known at analyze time (e.g. sl or sl-5.02)",
  ),
});
type AnalyzeArgs = z.infer<typeof AnalyzeArgsSchema>;

const AuthorSchema = z.object({
  name: z.string(),
  pkgname: z.string(),
  pkgver: z.string(),
  pkgrel: z.string(),
  version: z.string(),
  license: z.array(z.string()),
  depends: z.array(z.string()),
  makedepends: z.array(z.string()),
  reference: z.string(),
  model: z.string(),
  numTurns: z.number(),
  durationMs: z.number(),
  costUsd: z.number(),
  confidence: z.string(),
  rationale: z.string(),
  passed: z.boolean(),
  timestamp: z.iso.datetime(),
});

const AuthorArgsSchema = z.object({
  dir: z.string().describe("Absolute path to the package directory to author the PKGBUILD into (created if missing)"),
  name: z.string().describe("Evidence key at authoring time (usually pkgname; version is not yet known)"),
  pkgname: z.string().describe("Requested package name"),
  url: z.string().describe("Upstream project / source URL from the packaging request"),
  description: z.string().describe("Requested package description"),
  license: z.string().default("").describe("Requested license (SPDX), if the requester supplied one"),
  analysisKey: z.string().describe("Evidence key of a prior analyze run to base authoring on (reads analysis-<key>)"),
  referencesDir: z.string().default("").describe(
    "Path to the arch-packaging skill references (pkgbuild.md + ecosystem files); empty = <repo>/.claude/skills/arch-packaging/references derived from the swamp repo location",
  ),
  model: z.string().default("claude-sonnet-5").describe("Model for the authoring call"),
  hints: z.string().default("").describe(
    "Maintainer hints for this authoring attempt (e.g. why a previous build failed and what to change)",
  ),
});
type AuthorArgs = z.infer<typeof AuthorArgsSchema>;

type Check = z.infer<typeof CheckSchema>;

/** Base system prompt for the constrained PKGBUILD-authoring Claude call. */
const AUTHOR_SYSTEM_PROMPT = `You are the PKGBUILD authoring stage of an automated Arch Linux packaging factory.

Write a production-quality PKGBUILD in the current working directory for the package described in the task, following the reference documentation appended below exactly.

Rules:
- Write files ONLY in the current working directory: the PKGBUILD, DESIGN.json, and any files shipped alongside the PKGBUILD (patches, .desktop files, .install scripts).
- The unpacked source tree is available read-only at the path given in the task. Inspect it (build manifests, docs, license files) before writing.
- Do NOT build, download, or run anything — later pipeline stages run updpkgsums, makepkg, lint, and audit. You do not have Bash.
- Write checksum arrays as sha256sums=('SKIP') placeholders — the checksums stage replaces them with real values.
- Set pkgver to the version evident from the source tree / URL; pkgrel=1.
- When you are done, write DESIGN.json in the current directory with EXACTLY this shape:
  {
    "rationale": "<how you designed this PKGBUILD and why — written as readable markdown: short paragraphs and bullet points, one point per decision; never one long paragraph>",
    "dependencies": { "depends": [..], "makedepends": [..], "reasoning": "<why these>" },
    "license": { "spdx": "<identifier used>", "reasoning": "<how you mapped it>" },
    "deviations": "<anything where you deviated from the references, and why; empty string if none>",
    "confidence": "high" | "medium" | "low"
  }`;

function srcinfoAll(srcinfo: string, key: string): string[] {
  return [...srcinfo.matchAll(new RegExp(`^\\s*${key} = (.+)$`, "gm"))].map((m) => m[1].trim());
}

// ---------------------------------------------------------------------------
// Zero-setup build isolation via user namespaces (unshare -r --map-auto).
// A cached Arch rootfs + a per-package overlayfs layer give each build a
// disposable root where pacman can install makedepends without host sudo.
// Inside the namespace "root" is kernel-real (unlike fakeroot's LD_PRELOAD,
// which static binaries like deno see straight through); makepkg itself runs
// re-mapped to an unprivileged uid because it refuses to run as root.
// ---------------------------------------------------------------------------

const ISOLATE_CACHE = `${Deno.env.get("HOME")}/.cache/omarchy-factory`;

const ISOLATE_PACCONF = `[options]
Architecture = auto
SigLevel = Required DatabaseOptional
[core]
Include = /etc/pacman.d/mirrorlist
[extra]
Include = /etc/pacman.d/mirrorlist
`;

const ISOLATE_HARNESS = `#!/usr/bin/env bash
# Runs INSIDE 'unshare -r --map-auto -m'. Modes: bootstrap | installdeps | build
set -euo pipefail
mode=$1; cache=$2; key=$3; pkgdir=$4; shift 4
rootfs="$cache/rootfs"
pkgcache="$cache/pkgcache"
conf="$cache/pacman.conf"
mkdir -p "$pkgcache"

if [[ $mode == bootstrap ]]; then
  mkdir -p "$rootfs/var/lib/pacman"
  pacman -r "$rootfs" --config "$conf" --dbpath "$rootfs/var/lib/pacman" \\
    --cachedir "$pkgcache" -Sy --needed --noconfirm base-devel namcap shellcheck
  exit 0
fi

ovl="$cache/overlays/$key"
mkdir -p "$ovl/upper" "$ovl/work" "$ovl/merged"
mount -t overlay overlay \\
  -o "lowerdir=$rootfs,upperdir=$ovl/upper,workdir=$ovl/work" "$ovl/merged"
M="$ovl/merged"
mkdir -p "$M/build" "$M/proc"
mount --rbind "$pkgdir" "$M/build"
mount -t proc proc "$M/proc"
mount --rbind /dev "$M/dev"
cp -L /etc/resolv.conf "$M/etc/resolv.conf"

case $mode in
  installdeps)
    pacman -r "$M" --config "$conf" --dbpath "$M/var/lib/pacman" \\
      --cachedir "$pkgcache" -Sy --needed --noconfirm "$@"
    ;;
  exec)
    # Run a tool inside the build root with /build mounted (namcap, shellcheck).
    chroot "$M" /usr/bin/env HOME=/build TERM=dumb \\
      PATH=/usr/local/bin:/usr/bin:/bin \\
      bash -c 'cd /build && exec "$0" "$@"' "$@"
    ;;
  build)
    # pivot_root (not chroot): the kernel forbids creating the nested user
    # namespace below from inside a chroot, and we need that namespace to
    # re-map root to uid 1000 because makepkg refuses uid 0. Child-ns 1000 ==
    # parent-ns 0 == the real invoking user on the host, so artifacts written
    # into the bind-mounted /build belong to the user.
    mkdir -p "$M/oldroot"
    pivot_root "$M" "$M/oldroot"
    cd /
    umount -l /oldroot
    export HOME=/build USER=builder LOGNAME=builder TERM=dumb
    export PATH=/usr/local/bin:/usr/bin:/bin SHELL=/bin/bash
    exec unshare --map-user=1000 --map-group=1000 \\
      bash -c 'cd /build && makepkg -f --noconfirm --noprogressbar'
    ;;
esac
`;

/** Write the isolation harness + pacman.conf into the cache dir; returns the harness path. */
async function ensureIsolation(): Promise<string> {
  await Deno.mkdir(ISOLATE_CACHE, { recursive: true });
  const harness = `${ISOLATE_CACHE}/harness.sh`;
  await Deno.writeTextFile(harness, ISOLATE_HARNESS);
  await Deno.writeTextFile(`${ISOLATE_CACHE}/pacman.conf`, ISOLATE_PACCONF);
  await Deno.chmod(harness, 0o755);
  return harness;
}

async function rootfsExists(): Promise<boolean> {
  try {
    await Deno.stat(`${ISOLATE_CACHE}/rootfs/usr/bin/makepkg`);
    return true;
  } catch {
    return false;
  }
}

function runIsolated(harness: string, mode: string, key: string, pkgdir: string, extra: string[] = []): Promise<RunResult> {
  return run("unshare", ["-r", "--map-auto", "-m", "--fork", "--pid", "--", "bash", harness, mode, ISOLATE_CACHE, key, pkgdir, ...extra]);
}

/** True when the cached rootfs has the given tool installed. */
async function toolInRootfs(tool: string): Promise<boolean> {
  try {
    await Deno.stat(`${ISOLATE_CACHE}/rootfs/usr/bin/${tool}`);
    return true;
  } catch {
    return false;
  }
}

/**
 * Run a lint tool, preferring execution inside the package's build root (where
 * the package's dependencies are installed, giving namcap a real database to
 * resolve against); falls back to the host tool when the rootfs lacks it.
 * Paths in `args` must be relative to the package dir (mounted as /build).
 */
async function runTool(
  tool: string,
  toolArgs: string[],
  key: string,
  pkgdir: string,
): Promise<RunResult> {
  if (await toolInRootfs(tool)) {
    const harness = await ensureIsolation();
    return await runIsolated(harness, "exec", key, pkgdir, [tool, ...toolArgs]);
  }
  return await run(tool, toolArgs, pkgdir);
}

/** Package names from .SRCINFO dep lines: strip version constraints and soname entries. */
function depPackages(srcinfo: string): string[] {
  const keys = ["depends", "makedepends", "checkdepends"];
  const out = new Set<string>();
  for (const k of keys) {
    for (const d of srcinfoAll(srcinfo, k)) {
      const name = d.split(/[<>=]/)[0].trim();
      if (name && !name.includes(".so")) out.add(name);
    }
  }
  return [...out].sort();
}

interface RunResult {
  ok: boolean;
  code: number;
  stdout: string;
  stderr: string;
  output: string;
  missing: boolean;
}

/** Run a command, capturing output. `missing` is true when the binary is not installed. */
async function run(cmd: string, args: string[], cwd?: string): Promise<RunResult> {
  try {
    const proc = new Deno.Command(cmd, { args, cwd, stdout: "piped", stderr: "piped" });
    const res = await proc.output();
    const stdout = new TextDecoder().decode(res.stdout);
    const stderr = new TextDecoder().decode(res.stderr);
    return { ok: res.code === 0, code: res.code, stdout, stderr, output: stdout + stderr, missing: false };
  } catch (err) {
    if (err instanceof Deno.errors.NotFound) {
      return { ok: false, code: -1, stdout: "", stderr: `${cmd}: not installed`, output: `${cmd}: not installed`, missing: true };
    }
    throw err;
  }
}

function srcinfoField(srcinfo: string, key: string): string {
  const m = srcinfo.match(new RegExp(`^\\s*${key} = (.+)$`, "m"));
  return m ? m[1].trim() : "";
}

function summarize(checks: Check[]): { failCount: number; warnCount: number; passed: boolean } {
  const failCount = checks.filter((c) => c.level === "fail").length;
  const warnCount = checks.filter((c) => c.level === "warn").length;
  return { failCount, warnCount, passed: failCount === 0 };
}

function namcapChecks(output: string, subject: string): Check[] {
  const errors = output.split("\n").filter((l) => l.includes(" E: "));
  const warnings = output.split("\n").filter((l) => l.includes(" W: "));
  return [
    {
      name: `namcap-${subject}-errors`,
      level: errors.length ? "fail" : "pass",
      detail: errors.length ? errors.join("\n") : "no namcap errors",
    },
    {
      name: `namcap-${subject}-warnings`,
      level: warnings.length ? "warn" : "pass",
      detail: warnings.length ? warnings.join("\n") : "no namcap warnings",
    },
  ];
}

/** Regenerate .SRCINFO next to the PKGBUILD. Returns true on success. */
async function writeSrcinfo(dir: string): Promise<boolean> {
  const res = await run("makepkg", ["--printsrcinfo"], dir);
  if (!res.ok) return false;
  await Deno.writeTextFile(`${dir}/.SRCINFO`, res.stdout);
  return true;
}

/** Build-system detection: marker file → system id, in priority order. */
const BUILD_SYSTEM_MARKERS: Array<[string, string]> = [
  ["Cargo.toml", "rust"],
  ["pyproject.toml", "python"],
  ["setup.py", "python"],
  ["go.mod", "go"],
  ["package.json", "nodejs"],
  ["CMakeLists.txt", "cmake"],
  ["meson.build", "meson"],
  ["configure", "autotools"],
  ["configure.ac", "autotools"],
  ["autogen.sh", "autotools"],
  ["Makefile", "make"],
];

/** Which arch-packaging skill reference file covers each build system. */
const REFERENCE_FOR: Record<string, string> = {
  rust: "rust.md",
  python: "python.md",
  go: "go.md",
  nodejs: "nodejs.md",
  cmake: "c-cpp.md",
  meson: "c-cpp.md",
  autotools: "c-cpp.md",
  make: "c-cpp.md",
  unknown: "binary.md",
};

const LICENSE_PATTERNS: Array<[RegExp, string]> = [
  [/Apache License,?\s+Version 2\.0/i, "Apache-2.0"],
  [/GNU GENERAL PUBLIC LICENSE\s+Version 3/i, "GPL-3.0"],
  [/GNU GENERAL PUBLIC LICENSE\s+Version 2/i, "GPL-2.0"],
  [/GNU LESSER GENERAL PUBLIC LICENSE\s+Version 2\.1/i, "LGPL-2.1"],
  [/GNU LESSER GENERAL PUBLIC LICENSE\s+Version 3/i, "LGPL-3.0"],
  [/Mozilla Public License,?\s+(Version |v\.?\s*)?2\.0/i, "MPL-2.0"],
  [/Permission is hereby granted, free of charge/i, "MIT"],
  [/Redistribution and use in source and binary forms.*neither the name/is, "BSD-3-Clause"],
  [/Redistribution and use in source and binary forms/i, "BSD-2-Clause"],
  [/Permission to use, copy, modify, and\/or distribute this software/i, "ISC"],
  [/This is free and unencumbered software released into the public domain/i, "Unlicense"],
];

function guessSpdx(text: string): string {
  for (const [re, id] of LICENSE_PATTERNS) {
    if (re.test(text)) return id;
  }
  return "unknown";
}

type WriteResourceFn = (
  specName: string,
  name: string,
  data: Record<string, unknown>,
) => Promise<{ name: string }>;
type FileWriterFn = (
  specName: string,
  name: string,
) => { writeText: (text: string) => Promise<{ name: string }> };
type Logger = { info: (msg: string, props?: Record<string, unknown>) => void };

/** Arch Linux packaging pipeline: analyze sources, update checksums, build, lint, audit — evidence stored as data. */
export const model = {
  type: "@omarchy/arch-package",
  version: "2026.09.03.1",
  globalArguments: GlobalArgsSchema,
  resources: {
    "analysis": {
      description: "Source analysis evidence (instance per package: analysis-<name>)",
      schema: AnalysisSchema,
      lifetime: "infinite",
      garbageCollection: 20,
    },
    "checksums": {
      description: "updpkgsums + .SRCINFO evidence (instance per package: checksums-<name>)",
      schema: ChecksumsSchema,
      lifetime: "infinite",
      garbageCollection: 20,
    },
    "installdeps": {
      description: "Dependency installation into the isolated build root (instance per package: installdeps-<name>)",
      schema: InstalldepsSchema,
      lifetime: "infinite",
      garbageCollection: 20,
    },
    "build": {
      description: "makepkg build evidence (instance per package: build-<name>)",
      schema: BuildSchema,
      lifetime: "infinite",
      garbageCollection: 20,
    },
    "lint": {
      description: "PKGBUILD static lint evidence (instance per package: lint-<name>)",
      schema: LintSchema,
      lifetime: "infinite",
      garbageCollection: 20,
    },
    "audit": {
      description: "Built package audit evidence (instance per package: audit-<name>)",
      schema: AuditSchema,
      lifetime: "infinite",
      garbageCollection: 20,
    },
    "note": {
      description:
        "Agent-recorded design rationale (instance per package+stage: note-<name>-<stage>)",
      schema: NoteSchema,
      lifetime: "infinite",
      garbageCollection: 20,
    },
    "author": {
      description:
        "Structured PKGBUILD authoring evidence from the constrained Claude call (instance per package: author-<name>)",
      schema: AuthorSchema,
      lifetime: "infinite",
      garbageCollection: 20,
    },
  },
  files: {
    "log": {
      description: "Raw tool output for a pipeline stage",
      contentType: "text/plain",
      lifetime: "infinite",
      garbageCollection: 10,
    },
    "snapshot": {
      description: "PKGBUILD/.SRCINFO snapshots captured at build time (pkgbuild-<name>, srcinfo-<name>)",
      contentType: "text/plain",
      lifetime: "infinite",
      garbageCollection: 20,
    },
  },
  methods: {
    dossier: {
      description:
        "Assemble the durable per-package build dossier (markdown) from this package's stage evidence and store it as infinite data (dossier-<name>)",
      arguments: z.object({
        name: z.string().describe("Evidence key: <pkgname>-<pkgver>-<pkgrel>"),
        pkgname: z.string().describe("Bare package name (analysis/author/note evidence is keyed by it)"),
      }),
      execute: async (
        args: { name: string; pkgname: string },
        context: {
          globalArgs: GlobalArgs;
          logger: Logger;
          readResource: (name: string) => Promise<Record<string, unknown> | null>;
          createFileWriter: FileWriterFn;
        },
      ) => {
        const read = context.readResource;
        const analysis = await read(`analysis-${args.pkgname}`);
        const author = await read(`author-${args.pkgname}`);
        const checksums = await read(`checksums-${args.name}`);
        const build = await read(`build-${args.name}`);
        const lint = await read(`lint-${args.name}`);
        const audit = await read(`audit-${args.name}`);
        const note = await read(`note-${args.pkgname}-pkgbuild`);
        if (!build && !lint) {
          throw new Error(`No build/lint evidence for '${args.name}' — nothing to summarize`);
        }

        const line = (e: Record<string, unknown> | null) =>
          e ? (e.passed ? "passed" : "FAILED") : "no evidence";
        const checksTable = (e: Record<string, unknown> | null) => {
          const checks = (e?.checks ?? []) as Array<{ name: string; level: string; detail: string }>;
          if (!checks.length) return "_no checks recorded_\n";
          return "| Result | Check | Detail |\n|---|---|---|\n" + checks.map((c) =>
            `| ${c.level === "pass" ? "✅" : c.level === "warn" ? "⚠️" : "❌"} ${c.level} | ${c.name} | ${
              c.detail.split("\n")[0].slice(0, 90)
            } |`
          ).join("\n") + "\n";
        };

        const md: string[] = [`# Package Dossier: ${args.name}`];
        if (analysis) {
          md.push(`## Source analysis — ${line(analysis)}\n
- **Source**: ${analysis.url}
- **Build system**: ${analysis.buildSystem}
- **License files**: ${
            ((analysis.licenseFiles ?? []) as Array<{ path: string; spdxGuess: string }>)
              .map((l) => `${l.path} (guess: ${l.spdxGuess})`).join(", ") || "none"
          }\n`);
        }
        if (author) {
          md.push(`## PKGBUILD authoring — ${line(author)}\n
- **Version**: ${author.version} · **License**: ${(author.license as string[]).join(", ")}
- **depends**: ${(author.depends as string[]).join(", ") || "none"} · **makedepends**: ${
            (author.makedepends as string[]).join(", ") || "none"
          }
- **Model**: ${author.model} · confidence: ${author.confidence}\n
### Design rationale\n\n${author.rationale || "_none recorded_"}\n`);
        }
        if (note) md.push(`## Design notes\n\n${note.notes}\n`);
        if (checksums) md.push(`## Checksums — ${line(checksums)}\n`);
        if (build) {
          md.push(`## Build — ${line(build)}\n
- **Exit code**: ${build.exitCode} · **duration**: ${((build.durationMs as number) / 1000).toFixed(1)}s
- **Artifacts**: ${(build.artifacts as string[]).join(", ") || "none"}\n`);
        }
        if (lint) {
          md.push(`## Lint — ${line(lint)} (${lint.failCount} fail / ${lint.warnCount} warn)\n\n${checksTable(lint)}`);
        }
        if (audit) {
          md.push(`## Audit — ${line(audit)} (${audit.failCount} fail / ${audit.warnCount} warn)\n\n${checksTable(audit)}`);
        }
        const pkgbuild = build
          ? await (async () => {
            try {
              return await Deno.readTextFile(`${build.dir}/PKGBUILD`);
            } catch {
              return null;
            }
          })()
          : null;
        if (pkgbuild) md.push(`## PKGBUILD\n\n\`\`\`bash\n${pkgbuild}\n\`\`\`\n`);

        context.logger.info("dossier {name}: assembled from evidence", { name: args.name });
        const handle = await context.createFileWriter("snapshot", `dossier-${args.name}`)
          .writeText(md.join("\n"));
        return { dataHandles: [handle] };
      },
    },
    note: {
      description:
        "Record design rationale for a judgment step as evidence (deps chosen, license mapping, deviations)",
      arguments: NoteArgsSchema,
      execute: async (
        args: NoteArgs,
        context: { globalArgs: GlobalArgs; writeResource: WriteResourceFn },
      ) => {
        const handle = await context.writeResource("note", `note-${args.name}-${args.stage}`, {
          name: args.name,
          stage: args.stage,
          notes: args.notes,
          timestamp: new Date().toISOString(),
        });
        return { dataHandles: [handle] };
      },
    },
    analyze: {
      description:
        "Fetch and unpack sources, detect the build system, locate license files (deterministic part of source analysis)",
      arguments: AnalyzeArgsSchema,
      execute: async (
        args: AnalyzeArgs,
        context: {
          globalArgs: GlobalArgs;
          logger: Logger;
          writeResource: WriteResourceFn;
          createFileWriter: FileWriterFn;
        },
      ) => {
        await Deno.mkdir(args.workdir, { recursive: true });
        const rawLogs: string[] = [];
        let fetchOk = true;
        let fetchDetail = "";

        const isGit = args.url.startsWith("git+") || args.url.endsWith(".git");
        if (isGit) {
          const gitUrl = args.url.replace(/^git\+/, "").split("#")[0];
          const clone = await run("git", ["clone", "--depth=1", gitUrl, `${args.workdir}/src`]);
          rawLogs.push(`$ git clone --depth=1 ${gitUrl}\n${clone.output}`);
          fetchOk = clone.ok;
          fetchDetail = clone.ok ? "cloned" : clone.output.slice(0, 500);
        } else {
          const archive = `${args.workdir}/source-archive`;
          const dl = await run("curl", ["-fsSL", "-o", archive, args.url]);
          rawLogs.push(`$ curl -fsSL ${args.url}\n${dl.output || "(downloaded)"}`);
          if (!dl.ok) {
            fetchOk = false;
            fetchDetail = dl.output.slice(0, 500);
          } else {
            await Deno.mkdir(`${args.workdir}/src`, { recursive: true });
            const ex = await run("bsdtar", ["-xf", archive, "-C", `${args.workdir}/src`]);
            rawLogs.push(`$ bsdtar -xf source-archive\n${ex.output || "(extracted)"}`);
            fetchOk = ex.ok;
            fetchDetail = ex.ok ? "extracted" : ex.output.slice(0, 500);
          }
        }

        // Source root: sole top-level directory, else src/ itself.
        let srcRoot = `${args.workdir}/src`;
        let buildSystems: string[] = [];
        const licenseFiles: z.infer<typeof LicenseFileSchema>[] = [];
        const topLevelFiles: string[] = [];
        let hasTests = false;

        if (fetchOk) {
          const entries = [];
          for await (const e of Deno.readDir(srcRoot)) entries.push(e);
          if (entries.length === 1 && entries[0].isDirectory) {
            srcRoot = `${srcRoot}/${entries[0].name}`;
          }
          for await (const e of Deno.readDir(srcRoot)) {
            topLevelFiles.push(e.isDirectory ? `${e.name}/` : e.name);
          }
          topLevelFiles.sort();

          const names = new Set(topLevelFiles.map((f) => f.replace(/\/$/, "")));
          for (const [marker, system] of BUILD_SYSTEM_MARKERS) {
            if (names.has(marker) && !buildSystems.includes(system)) buildSystems.push(system);
          }
          hasTests = ["tests", "test", "spec"].some((d) => topLevelFiles.includes(`${d}/`));

          for (const f of topLevelFiles) {
            if (/^(LICENSE|LICENCE|COPYING|UNLICENSE)([._-].*)?$/i.test(f) && !f.endsWith("/")) {
              const text = await Deno.readTextFile(`${srcRoot}/${f}`);
              licenseFiles.push({
                path: f,
                spdxGuess: guessSpdx(text),
                snippet: text.slice(0, 300),
              });
            }
          }
        }

        const buildSystem = buildSystems[0] ?? "unknown";
        const reference = REFERENCE_FOR[buildSystem];
        context.logger.info("analyze {name}: buildSystem={buildSystem} licenses={n}", {
          name: args.name,
          buildSystem,
          n: licenseFiles.length,
        });

        const logWriter = context.createFileWriter("log", `analyzelog-${args.name}`);
        const logHandle = await logWriter.writeText(
          rawLogs.join("\n\n") + (fetchOk ? "" : `\n\nFETCH FAILED: ${fetchDetail}`),
        );
        const handle = await context.writeResource("analysis", `analysis-${args.name}`, {
          name: args.name,
          url: args.url,
          srcRoot,
          buildSystem,
          buildSystems,
          reference,
          licenseFiles,
          topLevelFiles: topLevelFiles.slice(0, 40),
          hasTests,
          passed: fetchOk,
          timestamp: new Date().toISOString(),
        });
        return { dataHandles: [handle, logHandle] };
      },
    },
    author: {
      description:
        "Author a PKGBUILD via a constrained Claude call (small system prompt, vetted read/write tools); produces structured design evidence later steps reference",
      arguments: AuthorArgsSchema,
      execute: async (
        args: AuthorArgs,
        context: {
          globalArgs: GlobalArgs;
          logger: Logger;
          repoDir: string;
          readResource: (name: string) => Promise<Record<string, unknown> | null>;
          writeResource: WriteResourceFn;
          createFileWriter: FileWriterFn;
        },
      ) => {
        await Deno.mkdir(args.dir, { recursive: true });
        const analysis = await context.readResource(`analysis-${args.analysisKey}`) as
          | z.infer<typeof AnalysisSchema>
          | null;
        if (!analysis) {
          throw new Error(`No analysis evidence 'analysis-${args.analysisKey}' — run analyze first`);
        }

        const refsDir = args.referencesDir ||
          `${context.repoDir}/../.claude/skills/arch-packaging/references`;
        let pkgbuildRef: string;
        let ecoRef: string;
        try {
          pkgbuildRef = await Deno.readTextFile(`${refsDir}/pkgbuild.md`);
          ecoRef = await Deno.readTextFile(`${refsDir}/${analysis.reference}`);
        } catch (err) {
          throw new Error(`Cannot read skill references from ${refsDir}: ${err}`);
        }
        const systemPrompt = `${AUTHOR_SYSTEM_PROMPT}\n\n# PKGBUILD reference\n\n${pkgbuildRef}\n\n# Ecosystem reference (${analysis.reference})\n\n${ecoRef}`;

        const task = `Package request:
- pkgname: ${args.pkgname}
- upstream URL: ${args.url}
- description: ${args.description}
- requested license: ${args.license || "(not specified — determine from source)"}

Source analysis (from the analyze stage):
- build system: ${analysis.buildSystem} (all markers: ${analysis.buildSystems.join(", ") || "none"})
- unpacked source tree (read-only): ${analysis.srcRoot}
- license files found: ${
          analysis.licenseFiles.map((l) => `${l.path} (guess: ${l.spdxGuess})`).join(", ") || "none"
        }
- has tests: ${analysis.hasTests}
- top-level files: ${analysis.topLevelFiles.join(" ")}

Write the PKGBUILD and DESIGN.json in the current directory.${
          args.hints ? `\n\nMAINTAINER HINTS (a maintainer reviewed a previous attempt — follow these):\n${args.hints}` : ""
        }`;

        const started = Date.now();
        const cl = await run("claude", [
          "-p",
          task,
          "--system-prompt",
          systemPrompt,
          "--allowedTools",
          "Read",
          "Glob",
          "Grep",
          "Write",
          "--permission-mode",
          "acceptEdits",
          "--add-dir",
          analysis.srcRoot,
          "--model",
          args.model,
          "--output-format",
          "json",
        ], args.dir);
        const durationMs = Date.now() - started;
        if (cl.missing) throw new Error("claude CLI not installed");

        let numTurns = 0;
        let costUsd = 0;
        let claudeOk = cl.ok;
        try {
          const res = JSON.parse(cl.stdout);
          numTurns = res.num_turns ?? 0;
          costUsd = res.total_cost_usd ?? 0;
          claudeOk = claudeOk && !res.is_error;
        } catch {
          claudeOk = false;
        }

        // Authoritative facts come from parsing what was actually written.
        const srcinfo = await run("makepkg", ["--printsrcinfo"], args.dir);
        const pkgver = srcinfoField(srcinfo.output, "pkgver");
        const pkgrel = srcinfoField(srcinfo.output, "pkgrel");

        let design: {
          rationale?: string;
          deviations?: string;
          confidence?: string;
          license?: { spdx?: string; reasoning?: string };
          dependencies?: { reasoning?: string };
        } | null = null;
        try {
          design = JSON.parse(await Deno.readTextFile(`${args.dir}/DESIGN.json`));
        } catch { /* absent or invalid — reflected in `passed` */ }

        const passed = claudeOk && srcinfo.ok && pkgver !== "" && design !== null;
        context.logger.info("author {name}: passed={passed} version={v} cost={costUsd}", {
          name: args.name,
          passed,
          v: `${pkgver}-${pkgrel}`,
          costUsd,
        });

        const logWriter = context.createFileWriter("log", `authorlog-${args.name}`);
        const logHandle = await logWriter.writeText(
          `# task prompt\n${task}\n\n# claude output (exit ${cl.code}, ${durationMs}ms)\n${cl.stdout}\n${cl.stderr}`,
        );
        const rationale = design?.rationale ?? "";
        const noteHandle = await context.writeResource("note", `note-${args.name}-pkgbuild`, {
          name: args.name,
          stage: "pkgbuild",
          notes: design
            ? `${rationale}\n\nDependencies: ${design.dependencies?.reasoning ?? ""}\nLicense: ${
              design.license?.reasoning ?? ""
            }\nDeviations: ${design.deviations || "none"}`
            : "DESIGN.json missing or invalid",
          timestamp: new Date().toISOString(),
        });
        const handle = await context.writeResource("author", `author-${args.name}`, {
          name: args.name,
          pkgname: srcinfoField(srcinfo.output, "pkgbase") || args.pkgname,
          pkgver,
          pkgrel,
          version: pkgver && pkgrel ? `${pkgver}-${pkgrel}` : "",
          license: srcinfoAll(srcinfo.output, "license"),
          depends: srcinfoAll(srcinfo.output, "depends"),
          makedepends: srcinfoAll(srcinfo.output, "makedepends"),
          reference: analysis.reference,
          model: args.model,
          numTurns,
          durationMs,
          costUsd,
          confidence: design?.confidence ?? "unknown",
          rationale,
          passed,
          timestamp: new Date().toISOString(),
        });
        return { dataHandles: [handle, noteHandle, logHandle] };
      },
    },
    checksums: {
      description: "Update PKGBUILD checksums with updpkgsums and regenerate .SRCINFO",
      arguments: DirArgsSchema,
      execute: async (
        args: DirArgs,
        context: {
          globalArgs: GlobalArgs;
          logger: Logger;
          writeResource: WriteResourceFn;
          createFileWriter: FileWriterFn;
        },
      ) => {
        try {
          await Deno.stat(`${args.dir}/PKGBUILD`);
        } catch {
          throw new Error(`No PKGBUILD found at ${args.dir}/PKGBUILD`);
        }
        const upd = await run("updpkgsums", [], args.dir);
        const srcinfoWritten = upd.ok ? await writeSrcinfo(args.dir) : false;
        const passed = upd.ok && srcinfoWritten;
        context.logger.info("checksums {name}: passed={passed}", { name: args.name, passed });

        const logWriter = context.createFileWriter("log", `checksumslog-${args.name}`);
        const logHandle = await logWriter.writeText(`$ updpkgsums\n${upd.output}`);
        const handle = await context.writeResource("checksums", `checksums-${args.name}`, {
          name: args.name,
          dir: args.dir,
          updated: upd.ok,
          srcinfoWritten,
          passed,
          timestamp: new Date().toISOString(),
        });
        return { dataHandles: [handle, logHandle] };
      },
    },
    installdeps: {
      description:
        "Install the PKGBUILD's depends/makedepends/checkdepends into the package's isolated build root (user-namespace overlay over a cached Arch rootfs; bootstraps the rootfs on first use, no sudo needed)",
      arguments: DirArgsSchema,
      execute: async (
        args: DirArgs,
        context: {
          globalArgs: GlobalArgs;
          logger: Logger;
          writeResource: WriteResourceFn;
          createFileWriter: FileWriterFn;
        },
      ) => {
        const srcinfo = await run("makepkg", ["--printsrcinfo"], args.dir);
        if (!srcinfo.ok) {
          throw new Error(`PKGBUILD in ${args.dir} does not parse — fix it before installdeps`);
        }
        const deps = depPackages(srcinfo.stdout);
        const harness = await ensureIsolation();
        const rawLogs: string[] = [];

        let rootfsBootstrapped = false;
        if (!(await rootfsExists())) {
          const boot = await runIsolated(harness, "bootstrap", args.name, args.dir);
          rawLogs.push(`$ harness bootstrap (exit ${boot.code})\n${boot.output}`);
          rootfsBootstrapped = boot.ok;
          if (!boot.ok) {
            const logHandle = await context.createFileWriter("log", `installdepslog-${args.name}`)
              .writeText(rawLogs.join("\n\n"));
            const handle = await context.writeResource("installdeps", `installdeps-${args.name}`, {
              name: args.name,
              dir: args.dir,
              deps,
              rootfsBootstrapped: false,
              passed: false,
              timestamp: new Date().toISOString(),
            });
            return { dataHandles: [handle, logHandle] };
          }
        }

        const inst = await runIsolated(harness, "installdeps", args.name, args.dir, deps);
        rawLogs.push(`$ harness installdeps ${deps.join(" ")} (exit ${inst.code})\n${inst.output}`);
        context.logger.info("installdeps {name}: passed={passed} deps={n}", {
          name: args.name,
          passed: inst.ok,
          n: deps.length,
        });

        const logHandle = await context.createFileWriter("log", `installdepslog-${args.name}`)
          .writeText(rawLogs.join("\n\n"));
        const handle = await context.writeResource("installdeps", `installdeps-${args.name}`, {
          name: args.name,
          dir: args.dir,
          deps,
          rootfsBootstrapped,
          passed: inst.ok,
          timestamp: new Date().toISOString(),
        });
        return { dataHandles: [handle, logHandle] };
      },
    },
    build: {
      description:
        "Build the package with makepkg in the isolated build root (set isolated=false for a bare host build), capturing the full build log",
      arguments: DirArgsSchema.extend({
        isolated: z.boolean().default(true).describe(
          "Build inside the user-namespace overlay root prepared by installdeps (default). false = bare makepkg on the host",
        ),
      }),
      execute: async (
        args: DirArgs & { isolated: boolean },
        context: {
          globalArgs: GlobalArgs;
          logger: Logger;
          writeResource: WriteResourceFn;
          createFileWriter: FileWriterFn;
        },
      ) => {
        try {
          await Deno.stat(`${args.dir}/PKGBUILD`);
        } catch {
          throw new Error(`No PKGBUILD found at ${args.dir}/PKGBUILD`);
        }
        const started = Date.now();
        let mk: RunResult;
        if (args.isolated) {
          const harness = await ensureIsolation();
          if (!(await rootfsExists())) {
            throw new Error("Isolated build root missing — run installdeps first (it bootstraps the rootfs)");
          }
          mk = await runIsolated(harness, "build", args.name, args.dir);
        } else {
          mk = await run("makepkg", ["-f", "--noconfirm", "--noprogressbar"], args.dir);
        }
        const durationMs = Date.now() - started;

        const artifacts: string[] = [];
        for await (const e of Deno.readDir(args.dir)) {
          if (e.isFile && /\.pkg\.tar\.(zst|xz|gz)$/.test(e.name)) artifacts.push(e.name);
        }
        artifacts.sort();
        const srcinfoWritten = mk.ok ? await writeSrcinfo(args.dir) : false;
        const passed = mk.ok && artifacts.some((a) => !a.includes("-debug-"));
        context.logger.info("build {name}: passed={passed} in {durationMs}ms", {
          name: args.name,
          passed,
          durationMs,
        });

        const logWriter = context.createFileWriter("log", `buildlog-${args.name}`);
        const logHandle = await logWriter.writeText(
          `$ makepkg -f --noconfirm --noprogressbar (exit ${mk.code}, ${durationMs}ms)\n${mk.output}`,
        );
        // Snapshot the design artifacts so the evidence chain includes the exact
        // PKGBUILD this build ran from.
        const handles = [logHandle];
        const pkgbuildText = await Deno.readTextFile(`${args.dir}/PKGBUILD`);
        handles.push(
          await context.createFileWriter("snapshot", `pkgbuild-${args.name}`)
            .writeText(pkgbuildText),
        );
        if (srcinfoWritten) {
          handles.push(
            await context.createFileWriter("snapshot", `srcinfo-${args.name}`)
              .writeText(await Deno.readTextFile(`${args.dir}/.SRCINFO`)),
          );
        }
        const handle = await context.writeResource("build", `build-${args.name}`, {
          name: args.name,
          dir: args.dir,
          exitCode: mk.code,
          durationMs,
          artifacts,
          srcinfoWritten,
          passed,
          timestamp: new Date().toISOString(),
        });
        return { dataHandles: [handle, logHandle] };
      },
    },
    lint: {
      description: "Statically lint a PKGBUILD (parse, shellcheck, namcap, policy checks)",
      arguments: DirArgsSchema,
      execute: async (
        args: DirArgs,
        context: {
          globalArgs: GlobalArgs;
          logger: Logger;
          writeResource: WriteResourceFn;
          createFileWriter: FileWriterFn;
        },
      ) => {
        const pkgbuildPath = `${args.dir}/PKGBUILD`;
        let text: string;
        try {
          text = await Deno.readTextFile(pkgbuildPath);
        } catch {
          throw new Error(`No PKGBUILD found at ${pkgbuildPath}`);
        }

        const checks: Check[] = [];
        const rawLogs: string[] = [];

        const srcinfo = await run("makepkg", ["--printsrcinfo"], args.dir);
        rawLogs.push(`$ makepkg --printsrcinfo\n${srcinfo.output}`);
        checks.push({
          name: "pkgbuild-parses",
          level: srcinfo.ok ? "pass" : "fail",
          detail: srcinfo.ok ? "makepkg --printsrcinfo succeeded" : srcinfo.output.slice(0, 1000),
        });
        const pkgname = srcinfoField(srcinfo.output, "pkgbase") ||
          srcinfoField(srcinfo.output, "pkgname");
        const pkgver = srcinfoField(srcinfo.output, "pkgver");

        const shellcheck = await runTool("shellcheck", [
          "--shell=bash",
          "--exclude=SC2034,SC2154,SC2164",
          "PKGBUILD",
        ], args.name, args.dir);
        if (!shellcheck.missing) {
          rawLogs.push(`$ shellcheck PKGBUILD\n${shellcheck.output}`);
          checks.push({
            name: "shellcheck",
            level: shellcheck.ok ? "pass" : "fail",
            detail: shellcheck.ok ? "clean" : shellcheck.output.slice(0, 2000),
          });
        }

        const namcap = await runTool("namcap", ["PKGBUILD"], args.name, args.dir);
        if (!namcap.missing) {
          rawLogs.push(`$ namcap PKGBUILD\n${namcap.output}`);
          checks.push(...namcapChecks(namcap.output, "pkgbuild"));
        }

        const isVcs = /^\s*source=.*(git\+|hg\+|svn\+|bzr\+)/m.test(text);
        const policy: Array<[string, boolean, "warn" | "fail", string]> = [
          ["no-usr-local", !text.includes("/usr/local"), "fail",
            "PKGBUILD references /usr/local"],
          ["https-sources", !/^\s*source=.*[^s]"?'?http:\/\//m.test(text), "fail",
            "plain http:// source URL; use https"],
          ["no-skip-checksums", isVcs || !/sums(_\w+)?=\([^)]*SKIP/s.test(text), "fail",
            "SKIP checksum on a non-VCS source"],
          ["strong-checksums", !/^\s*(md5sums|sha1sums|cksums)=/m.test(text), "warn",
            "weak checksum type (md5/sha1/ck); prefer sha256sums or b2sums"],
          ["has-package-fn", /package\s*\(\)/.test(text), "fail",
            "no package() function"],
          ["has-check-fn", /check\s*\(\)/.test(text) || /#.*check\(\)/i.test(text), "warn",
            "no check() function and no comment explaining why"],
          ["quoted-pkgdir", !/(^|[^"'])\$pkgdir/m.test(text), "warn",
            'unquoted $pkgdir; use "$pkgdir"'],
          ["quoted-srcdir", !/(^|[^"'])\$srcdir/m.test(text), "warn",
            'unquoted $srcdir; use "$srcdir"'],
          ["has-license", srcinfo.output.includes("license = "), "fail",
            "no license set"],
          ["has-arch", srcinfo.output.includes("arch = "), "fail",
            "no arch set"],
        ];
        for (const [name, ok, level, detail] of policy) {
          checks.push({ name, level: ok ? "pass" : level, detail: ok ? "ok" : detail });
        }

        const { failCount, warnCount, passed } = summarize(checks);
        context.logger.info("lint {name}: {failCount} failures, {warnCount} warnings", {
          name: args.name,
          failCount,
          warnCount,
        });

        const logWriter = context.createFileWriter("log", `lintlog-${args.name}`);
        const logHandle = await logWriter.writeText(rawLogs.join("\n\n"));
        const handle = await context.writeResource("lint", `lint-${args.name}`, {
          name: args.name,
          dir: args.dir,
          pkgname,
          pkgver,
          parseOk: srcinfo.ok,
          shellcheckAvailable: !shellcheck.missing,
          namcapAvailable: !namcap.missing,
          checks,
          failCount,
          warnCount,
          passed,
          timestamp: new Date().toISOString(),
        });
        return { dataHandles: [handle, logHandle] };
      },
    },
    audit: {
      description: "Audit the built .pkg.tar.zst (file list, metadata, namcap, forbidden paths)",
      arguments: DirArgsSchema,
      execute: async (
        args: DirArgs,
        context: {
          globalArgs: GlobalArgs;
          logger: Logger;
          writeResource: WriteResourceFn;
          createFileWriter: FileWriterFn;
        },
      ) => {
        let pkgFile = "";
        for await (const entry of Deno.readDir(args.dir)) {
          if (
            entry.isFile && /\.pkg\.tar\.(zst|xz|gz)$/.test(entry.name) &&
            !entry.name.includes("-debug-") && !entry.name.endsWith(".sig")
          ) {
            pkgFile = `${args.dir}/${entry.name}`;
            break;
          }
        }
        if (!pkgFile) {
          throw new Error(
            `No built package (*.pkg.tar.zst) in ${args.dir} — run makepkg before audit`,
          );
        }

        const checks: Check[] = [];
        const rawLogs: string[] = [];

        const qlp = await run("pacman", ["-Qlp", pkgFile]);
        rawLogs.push(`$ pacman -Qlp ${pkgFile}\n${qlp.output}`);
        const files = qlp.output.split("\n")
          .map((l) => l.split(/\s+/)[1] ?? "")
          .filter((f) => f.length > 0);
        const realFiles = files.filter((f) => !f.endsWith("/"));
        checks.push({
          name: "package-readable",
          level: qlp.ok ? "pass" : "fail",
          detail: qlp.ok ? `${files.length} entries` : qlp.output.slice(0, 500),
        });
        checks.push({
          name: "package-not-empty",
          level: realFiles.length > 0 ? "pass" : "fail",
          detail: realFiles.length > 0
            ? `${realFiles.length} files`
            : "package contains only directories",
        });
        const forbidden = files.filter((f) =>
          /^\/(usr\/local|bin\/|sbin\/|home\/|tmp\/|srv\/|run\/)/.test(f)
        );
        checks.push({
          name: "no-forbidden-paths",
          level: forbidden.length === 0 ? "pass" : "fail",
          detail: forbidden.length === 0 ? "ok" : forbidden.join("\n"),
        });
        const laFiles = files.filter((f) => f.endsWith(".la"));
        checks.push({
          name: "no-libtool-archives",
          level: laFiles.length === 0 ? "pass" : "warn",
          detail: laFiles.length === 0 ? "ok" : laFiles.join("\n"),
        });

        const qip = await run("pacman", ["-Qip", pkgFile]);
        rawLogs.push(`$ pacman -Qip ${pkgFile}\n${qip.output}`);
        checks.push({
          name: "metadata-readable",
          level: qip.ok ? "pass" : "fail",
          detail: qip.ok ? "ok" : qip.output.slice(0, 500),
        });

        const grep = await run("grep", ["-Rls", `${args.dir}/src`, `${args.dir}/pkg/`]);
        if (grep.code !== 2) {
          checks.push({
            name: "no-srcdir-references",
            level: grep.ok ? "fail" : "pass",
            detail: grep.ok ? `built files reference $srcdir:\n${grep.output}` : "ok",
          });
        }

        const pkgBase = pkgFile.slice(pkgFile.lastIndexOf("/") + 1);
        const namcap = await runTool("namcap", ["-i", pkgBase], args.name, args.dir);
        if (!namcap.missing) {
          rawLogs.push(`$ namcap -i ${pkgBase}\n${namcap.output}`);
          checks.push(...namcapChecks(namcap.output, "package"));
        }

        const { failCount, warnCount, passed } = summarize(checks);
        context.logger.info("audit {name}: {failCount} failures, {warnCount} warnings", {
          name: args.name,
          failCount,
          warnCount,
        });

        const logWriter = context.createFileWriter("log", `auditlog-${args.name}`);
        const logHandle = await logWriter.writeText(rawLogs.join("\n\n"));
        const handle = await context.writeResource("audit", `audit-${args.name}`, {
          name: args.name,
          dir: args.dir,
          packageFile: pkgFile,
          fileCount: realFiles.length,
          namcapAvailable: !namcap.missing,
          checks,
          failCount,
          warnCount,
          passed,
          timestamp: new Date().toISOString(),
        });
        return { dataHandles: [handle, logHandle] };
      },
    },
  },
};
