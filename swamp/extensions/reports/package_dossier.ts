/**
 * Package dossier report.
 *
 * Workflow-scope report that assembles the complete chain of evidence for an
 * Arch package pipeline run — request analysis, PKGBUILD authoring rationale,
 * checksums, build, lint, audit, design notes, and the PKGBUILD snapshot —
 * into one "how this package was designed" document. Runs automatically after
 * create-package / build-package / vet-package workflow runs; returns a stub
 * for workflows that touched no @omarchy/arch-package model.
 *
 * Retrieve with: swamp report get @omarchy/package-dossier --workflow <name> --markdown
 *
 * @module
 */
// extensions/reports/package_dossier.ts

const PACKAGE_MODEL_TYPE = "@omarchy/arch-package";

interface StepExecution {
  jobName: string;
  stepName: string;
  modelName: string;
  modelType: string;
  methodName: string;
  status: "succeeded" | "failed" | "skipped";
  methodArgs: Record<string, unknown>;
  modelId: string;
}

interface DataRepo {
  findAllForModel(type: string, modelId: string): Promise<Array<{ name: string }>>;
  getContent(type: string, modelId: string, dataName: string, version?: number): Promise<Uint8Array | null>;
}

interface DossierContext {
  workflowName: string;
  workflowRunId: string;
  workflowStatus: "succeeded" | "failed";
  stepExecutions: StepExecution[];
  dataRepository: DataRepo;
}

async function readJson(
  repo: DataRepo,
  modelId: string,
  name: string,
): Promise<Record<string, unknown> | null> {
  const raw = await repo.getContent(PACKAGE_MODEL_TYPE, modelId, name);
  if (!raw) return null;
  try {
    return JSON.parse(new TextDecoder().decode(raw));
  } catch {
    return null;
  }
}

async function readText(repo: DataRepo, modelId: string, name: string): Promise<string | null> {
  const raw = await repo.getContent(PACKAGE_MODEL_TYPE, modelId, name);
  return raw ? new TextDecoder().decode(raw) : null;
}

function checksTable(evidence: Record<string, unknown> | null): string {
  const checks = (evidence?.checks ?? []) as Array<{ name: string; level: string; detail: string }>;
  if (!checks.length) return "_no checks recorded_\n";
  const rows = checks.map((c) =>
    `| ${c.level === "pass" ? "✅" : c.level === "warn" ? "⚠️" : "❌"} ${c.level} | ${c.name} | ${
      c.detail.split("\n")[0].slice(0, 90)
    } |`
  );
  return `| Result | Check | Detail |\n|---|---|---|\n${rows.join("\n")}\n`;
}

function stageLine(evidence: Record<string, unknown> | null): string {
  if (!evidence) return "no evidence recorded";
  return evidence.passed ? "passed" : "FAILED";
}

/** Assembles the full design-provenance dossier for an Arch package pipeline run. */
export const report = {
  name: "@omarchy/package-dossier",
  description:
    "Chain-of-evidence dossier for an Arch package: analysis, authoring rationale, checksums, build, lint, audit, notes, and PKGBUILD snapshot",
  scope: "workflow" as const,
  labels: ["dossier", "factory"],
  execute: async (context: DossierContext) => {
    const pkgSteps = context.stepExecutions.filter((s) => s.modelType === PACKAGE_MODEL_TYPE);
    if (pkgSteps.length === 0) {
      return {
        markdown: `_Not an arch-package pipeline run — no dossier for workflow ${context.workflowName}._`,
        json: { applicable: false, workflowName: context.workflowName },
      };
    }
    const modelId = pkgSteps[0].modelId;
    const repo = context.dataRepository;

    // Evidence keys used by this run (e.g. "entr" for analyze/author, "entr-5.8-1" for build/lint).
    // A versioned key also implies its base keys (entr-5.8-1 → entr-5.8, entr) so a
    // build-only run still pulls the analysis/authoring evidence recorded under the bare pkgname.
    const keySet = new Set(
      pkgSteps.map((s) => s.methodArgs?.name).filter((n): n is string => typeof n === "string"),
    );
    for (const k of [...keySet]) {
      let base = k;
      for (let i = 0; i < 2 && base.includes("-"); i++) {
        base = base.slice(0, base.lastIndexOf("-"));
        keySet.add(base);
      }
    }
    const keys = [...keySet].sort((a, b) => b.length - a.length); // longest (most specific) first
    const all = await repo.findAllForModel(PACKAGE_MODEL_TYPE, modelId);
    const names = new Set(all.map((d) => d.name));
    const find = (prefix: string): string | null => {
      for (const k of keys) if (names.has(`${prefix}-${k}`)) return `${prefix}-${k}`;
      return null;
    };

    const analysisName = find("analysis");
    const authorName = find("author");
    const checksumsName = find("checksums");
    const buildName = find("build");
    const lintName = find("lint");
    const auditName = find("audit");
    const pkgbuildName = find("pkgbuild");

    const analysis = analysisName ? await readJson(repo, modelId, analysisName) : null;
    const author = authorName ? await readJson(repo, modelId, authorName) : null;
    const checksums = checksumsName ? await readJson(repo, modelId, checksumsName) : null;
    const build = buildName ? await readJson(repo, modelId, buildName) : null;
    const lint = lintName ? await readJson(repo, modelId, lintName) : null;
    const audit = auditName ? await readJson(repo, modelId, auditName) : null;
    const pkgbuild = pkgbuildName ? await readText(repo, modelId, pkgbuildName) : null;

    const noteNames = [...names].filter((n) => keys.some((k) => n.startsWith(`note-${k}`))).sort();
    const notes: Array<{ name: string; stage: string; notes: string }> = [];
    for (const n of noteNames) {
      const note = await readJson(repo, modelId, n);
      if (note) notes.push({ name: n, stage: String(note.stage ?? ""), notes: String(note.notes ?? "") });
    }

    const pkgname = String(author?.pkgname ?? lint?.pkgname ?? keys[0] ?? "unknown");
    const versionedKey = keys.find((k) => k.startsWith(`${pkgname}-`));
    const version = String(
      author?.version ?? (versionedKey ? versionedKey.slice(pkgname.length + 1) : lint?.pkgver ?? ""),
    );

    const stepRows = context.stepExecutions.map((s) =>
      `| ${s.status === "succeeded" ? "✅" : s.status === "skipped" ? "⏭️" : "❌"} ${s.status} | ${s.jobName}/${s.stepName} | ${s.methodName || "-"} |`
    ).join("\n");

    const md: string[] = [];
    md.push(`# Package Dossier: ${pkgname}${version ? ` ${version}` : ""}`);
    md.push(
      `Workflow **${context.workflowName}** run \`${context.workflowRunId}\` — **${context.workflowStatus}**\n`,
    );
    md.push(`## Pipeline steps\n\n| Status | Step | Method |\n|---|---|---|\n${stepRows}\n`);

    if (analysis) {
      const lic = (analysis.licenseFiles as Array<{ path: string; spdxGuess: string }> ?? [])
        .map((l) => `${l.path} (guess: ${l.spdxGuess})`).join(", ") || "none found";
      md.push(`## Source analysis — ${stageLine(analysis)}

- **Source**: ${analysis.url}
- **Build system**: ${analysis.buildSystem} (markers: ${(analysis.buildSystems as string[]).join(", ") || "none"})
- **Skill reference used**: ${analysis.reference}
- **License files**: ${lic}
- **Has tests**: ${analysis.hasTests}
`);
    }

    if (author) {
      md.push(`## PKGBUILD authoring — ${stageLine(author)}

- **Version authored**: ${author.version}
- **License**: ${(author.license as string[]).join(", ")}
- **depends**: ${(author.depends as string[]).join(", ") || "none"}
- **makedepends**: ${(author.makedepends as string[]).join(", ") || "none"}
- **Model**: ${author.model} · ${author.numTurns} turns · $${Number(author.costUsd).toFixed(4)} · confidence: ${author.confidence}

### Design rationale

${author.rationale || "_none recorded_"}
`);
    }

    if (notes.length) {
      md.push(`## Design notes\n`);
      for (const n of notes) {
        md.push(`### ${n.stage}\n\n${n.notes}\n`);
      }
    }

    if (checksums) {
      md.push(
        `## Checksums — ${stageLine(checksums)}\n\n- updpkgsums: ${checksums.updated ? "updated" : "failed"}; .SRCINFO ${checksums.srcinfoWritten ? "regenerated" : "NOT written"}\n`,
      );
    }

    if (build) {
      md.push(`## Build — ${stageLine(build)}

- **Exit code**: ${build.exitCode} · **duration**: ${((build.durationMs as number) / 1000).toFixed(1)}s
- **Artifacts**: ${(build.artifacts as string[]).join(", ") || "none"}
`);
    }

    if (lint) {
      md.push(
        `## Lint — ${stageLine(lint)} (${lint.failCount} fail / ${lint.warnCount} warn)\n\n${checksTable(lint)}`,
      );
    }
    if (audit) {
      md.push(
        `## Audit — ${stageLine(audit)} (${audit.failCount} fail / ${audit.warnCount} warn)\n\n- **Package**: ${audit.packageFile} (${audit.fileCount} files)\n\n${checksTable(audit)}`,
      );
    }

    if (pkgbuild) {
      md.push(`## PKGBUILD (snapshot at build time)\n\n\`\`\`bash\n${pkgbuild}\n\`\`\`\n`);
    }

    return {
      markdown: md.join("\n"),
      json: {
        applicable: true,
        pkgname,
        version,
        workflowName: context.workflowName,
        workflowRunId: context.workflowRunId,
        workflowStatus: context.workflowStatus,
        stages: {
          analysis: analysis && { passed: analysis.passed, buildSystem: analysis.buildSystem },
          author: author && {
            passed: author.passed,
            version: author.version,
            license: author.license,
            depends: author.depends,
            makedepends: author.makedepends,
            confidence: author.confidence,
            costUsd: author.costUsd,
          },
          checksums: checksums && { passed: checksums.passed },
          build: build && {
            passed: build.passed,
            durationMs: build.durationMs,
            artifacts: build.artifacts,
          },
          lint: lint && { passed: lint.passed, failCount: lint.failCount, warnCount: lint.warnCount },
          audit: audit && {
            passed: audit.passed,
            failCount: audit.failCount,
            warnCount: audit.warnCount,
          },
        },
        notes: notes.map((n) => ({ stage: n.stage, notes: n.notes })),
      },
    };
  },
};
