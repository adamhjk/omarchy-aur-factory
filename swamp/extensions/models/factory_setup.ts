/**
 * Factory setup model — idempotent convergence for a new box.
 *
 * `converge` verifies every prerequisite of the omarchy factory and fixes
 * everything fixable without privileges: it probes user-namespace and
 * overlayfs support with real kernel operations, bootstraps the isolated
 * build rootfs by running the actual packaging pipeline's installdeps stage
 * against a generated seed package, creates working directories, and installs
 * the web app's node modules. Long steps announce themselves through the
 * logger so the run streams progress. Anything requiring sudo or a login
 * reports `missing` with the exact remediation command.
 *
 * Safe to run repeatedly: a converged box reports all `ok` and changes
 * nothing. Target UX for a new box: install swamp, clone the repo,
 * `swamp model @omarchy/factory-setup method run converge setup`.
 *
 * @module
 */
// extensions/models/factory_setup.ts
import { z } from "npm:zod@4";

const GlobalArgsSchema = z.object({});
type GlobalArgs = z.infer<typeof GlobalArgsSchema>;

const SetupCheckSchema = z.object({
  name: z.string(),
  status: z.enum(["ok", "fixed", "missing"]),
  detail: z.string(),
});
type SetupCheck = z.infer<typeof SetupCheckSchema>;

const SetupSchema = z.object({
  checks: z.array(SetupCheckSchema),
  fixedCount: z.number(),
  missingCount: z.number(),
  passed: z.boolean(),
  timestamp: z.iso.datetime(),
});

const ConvergeArgsSchema = z.object({
  deep: z.boolean().default(false).describe(
    "Also run the app's test+build and a full isolated build-package on the seed package (slower, strongest verification)",
  ),
});
type ConvergeArgs = z.infer<typeof ConvergeArgsSchema>;

interface RunResult {
  ok: boolean;
  code: number;
  output: string;
  missing: boolean;
}

async function run(cmd: string, args: string[], cwd?: string): Promise<RunResult> {
  try {
    const proc = new Deno.Command(cmd, { args, cwd, stdout: "piped", stderr: "piped" });
    const res = await proc.output();
    const output = new TextDecoder().decode(res.stdout) + new TextDecoder().decode(res.stderr);
    return { ok: res.code === 0, code: res.code, output, missing: false };
  } catch (err) {
    if (err instanceof Deno.errors.NotFound) {
      return { ok: false, code: -1, output: `${cmd}: not installed`, missing: true };
    }
    throw err;
  }
}

async function exists(path: string): Promise<boolean> {
  try {
    await Deno.stat(path);
    return true;
  } catch {
    return false;
  }
}

/**
 * Minimal seed PKGBUILD, generated at converge time so the repo ships no
 * packages and a fresh clone starts cold. It exists purely to exercise the
 * real pipeline stages (installdeps bootstrap, and the full build in deep
 * mode) against a trivially correct package.
 */
const SEED_PKGBUILD = `pkgname=factory-seed
pkgver=1
pkgrel=1
pkgdesc="Omarchy factory convergence seed"
arch=(any)
url="https://github.com/adamhjk/omarchy-aur-factory"
license=(0BSD)
depends=(glibc ncurses)
source=()
sha256sums=()

# check() intentionally omitted: nothing to test in the seed.
package() {
  install -Dm644 /dev/null "$pkgdir/usr/share/factory-seed/seed"
}
`;

/** Host commands the factory needs, with remediation for missing ones. */
const HOST_COMMANDS: Array<[string, string]> = [
  ["makepkg", "sudo pacman -S --needed base-devel"],
  ["updpkgsums", "sudo pacman -S --needed pacman-contrib"],
  ["bsdtar", "sudo pacman -S --needed libarchive"],
  ["curl", "sudo pacman -S --needed curl"],
  ["git", "sudo pacman -S --needed git"],
  ["unshare", "sudo pacman -S --needed util-linux"],
  ["node", "sudo pacman -S --needed nodejs npm (or use mise) — needed for the web app"],
  ["npm", "sudo pacman -S --needed npm (or use mise) — needed for the web app"],
  ["claude", "install Claude Code (https://claude.com/claude-code) and run `claude` once to log in"],
];

/** Idempotently converge the factory's host prerequisites; evidence records every check. */
export const model = {
  type: "@omarchy/factory-setup",
  version: "2026.09.03.1",
  globalArguments: GlobalArgsSchema,
  resources: {
    "setup": {
      description: "Convergence evidence: every prerequisite check with ok/fixed/missing status",
      schema: SetupSchema,
      lifetime: "infinite",
      garbageCollection: 20,
    },
  },
  methods: {
    converge: {
      description:
        "Verify and (where possible without sudo) fix everything the factory needs on this box; idempotent",
      arguments: ConvergeArgsSchema,
      execute: async (
        args: ConvergeArgs,
        context: {
          globalArgs: GlobalArgs;
          logger: { info: (msg: string, props?: Record<string, unknown>) => void };
          repoDir: string;
          writeResource: (
            specName: string,
            name: string,
            data: Record<string, unknown>,
          ) => Promise<{ name: string }>;
          createFileWriter: (
            specName: string,
            name: string,
          ) => { writeText: (text: string) => Promise<{ name: string }> };
        },
      ) => {
        const root = `${context.repoDir}/..`;
        const home = Deno.env.get("HOME");
        const cache = `${home}/.cache/omarchy-factory`;
        const checks: SetupCheck[] = [];
        const logs: string[] = [];
        const add = (name: string, status: SetupCheck["status"], detail: string) =>
          checks.push({ name, status, detail });

        const say = (msg: string) => context.logger.info(msg);

        // 1. Host commands (report-only; installing needs sudo or a login).
        say("checking host commands...");
        for (const [cmd, fix] of HOST_COMMANDS) {
          const probe = await run(cmd, ["--version"]);
          add(`command-${cmd}`, probe.missing ? "missing" : "ok", probe.missing ? fix : "present");
        }

        // 2. Kernel capabilities, probed with the real operations.
        say("probing user-namespace and overlayfs support...");
        const userns = await run("unshare", ["-r", "--map-auto", "true"]);
        add(
          "userns-map-auto",
          userns.ok ? "ok" : "missing",
          userns.ok
            ? "user namespaces + subuid mapping work"
            : `${userns.output.trim().slice(0, 120)} — fix: sudo usermod --add-subuids 100000-165535 --add-subgids 100000-165535 $USER`,
        );
        const ovl = await run("unshare", [
          "-rm",
          "sh",
          "-c",
          `d=$(mktemp -d); mkdir -p $d/l $d/u $d/w $d/m && mount -t overlay overlay -o lowerdir=$d/l,upperdir=$d/u,workdir=$d/w $d/m && echo OK`,
        ]);
        add(
          "userns-overlayfs",
          ovl.ok ? "ok" : "missing",
          ovl.ok ? "overlayfs mounts inside a user namespace" : "kernel too old (<5.11) or overlay disabled",
        );

        // 3. Repo layout (skill references, app) + generated seed package.
        const refs = `${root}/.claude/skills/arch-packaging/references/pkgbuild.md`;
        add("skill-references", (await exists(refs)) ? "ok" : "missing", refs);
        const seedDir = "/tmp/omarchy-factory-scratch/factory-seed";
        await Deno.mkdir(seedDir, { recursive: true });
        await Deno.writeTextFile(`${seedDir}/PKGBUILD`, SEED_PKGBUILD);
        add("seed-package", "ok", `generated at ${seedDir}`);

        // 4. Working directories (converge).
        for (const d of [`${root}/test-packages`, "/tmp/omarchy-factory-scratch"]) {
          const had = await exists(d);
          await Deno.mkdir(d, { recursive: true });
          add(`dir-${d.split("/").pop()}`, had ? "ok" : "fixed", d);
        }

        // 5. Isolated build rootfs — converge by running the REAL pipeline stage
        // (installdeps on the seed package), which bootstraps on first use and
        // verifies namespace + overlay + pacman end to end.
        const rootfsReady = await exists(`${cache}/rootfs/usr/bin/namcap`);
        if (rootfsReady && !args.deep) {
          add("build-rootfs", "ok", `${cache}/rootfs (base-devel + namcap + shellcheck)`);
        } else if (userns.ok && ovl.ok && await exists(`${seedDir}/PKGBUILD`)) {
          say(
            rootfsReady
              ? "verifying build rootfs via seed installdeps..."
              : "bootstrapping the isolated build rootfs — downloads base-devel, can take several minutes on first run...",
          );
          const seed = await run("swamp", [
            "model",
            "@omarchy/arch-package",
            "method",
            "run",
            "installdeps",
            "packager",
            "--repo-dir",
            context.repoDir,
            "--input",
            `dir=${seedDir}`,
            "--input",
            "name=factory-seed-1-1",
            "--json",
          ]);
          logs.push(`$ installdeps seed (exit ${seed.code})\n${seed.output.slice(-2000)}`);
          add(
            "build-rootfs",
            seed.ok ? (rootfsReady ? "ok" : "fixed") : "missing",
            seed.ok
              ? `bootstrapped and verified via installdeps on the seed package`
              : "seed installdeps failed — see setuplog",
          );
        } else {
          add("build-rootfs", "missing", "blocked on userns/overlayfs/seed checks above");
        }

        // 6. Web app dependencies (converge when node is present).
        const appDir = `${root}/app/omarchy-package-request`;
        if (await exists(`${appDir}/package.json`)) {
          if (await exists(`${appDir}/node_modules`)) {
            add("app-node-modules", "ok", appDir);
          } else if (!(await run("npm", ["--version"])).missing) {
            say("installing web app dependencies (npm install) — can take a few minutes on first run...");
            const inst = await run("npm", ["install", "--silent"], appDir);
            logs.push(`$ npm install (exit ${inst.code})\n${inst.output.slice(-1500)}`);
            add("app-node-modules", inst.ok ? "fixed" : "missing", inst.ok ? "npm install completed" : "npm install failed — see setuplog");
          } else {
            add("app-node-modules", "missing", "npm not installed (see command-npm)");
          }
          if (args.deep) {
            say("deep: running the web app's test suite and production build...");
            const test = await run("npm", ["run", "test", "--silent"], appDir);
            const build = await run("npm", ["run", "build", "--silent"], appDir);
            logs.push(`$ npm test (exit ${test.code})\n${test.output.slice(-1000)}`);
            logs.push(`$ npm run build (exit ${build.code})\n${build.output.slice(-1000)}`);
            add("app-test-build", test.ok && build.ok ? "ok" : "missing", `test:${test.ok} build:${build.ok}`);
          }
        } else {
          add("app-present", "missing", appDir);
        }

        // 7. Deep: full isolated pipeline on the seed package — the strongest proof.
        if (args.deep) {
          say("deep: building and vetting the seed package end-to-end...");
          const wf = await run("swamp", [
            "workflow",
            "run",
            "build-package",
            "--repo-dir",
            context.repoDir,
            "--input",
            `dir=${seedDir}`,
            "--input",
            "name=factory-seed",
            "--input",
            "version=1-1",
            "--json",
          ]);
          logs.push(`$ build-package seed (exit ${wf.code})\n${wf.output.slice(-2000)}`);
          const failed = wf.output.includes('"status": "failed"');
          add("seed-pipeline", wf.ok && !failed ? "ok" : "missing", wf.ok && !failed ? "full isolated build+vet green" : "seed pipeline failed — see setuplog");
        }

        const fixedCount = checks.filter((c) => c.status === "fixed").length;
        const missingCount = checks.filter((c) => c.status === "missing").length;
        const passed = missingCount === 0;
        context.logger.info("converge: passed={passed} fixed={fixedCount} missing={missingCount}", {
          passed,
          fixedCount,
          missingCount,
        });

        const logHandle = await context.createFileWriter("setuplog", "setuplog")
          .writeText(logs.join("\n\n") || "no convergence actions were needed");
        const handle = await context.writeResource("setup", "setup", {
          checks,
          fixedCount,
          missingCount,
          passed,
          timestamp: new Date().toISOString(),
        });
        return { dataHandles: [handle, logHandle] };
      },
    },
  },
  files: {
    "setuplog": {
      description: "Raw output of convergence actions",
      contentType: "text/plain",
      lifetime: "infinite",
      garbageCollection: 10,
    },
  },
};
