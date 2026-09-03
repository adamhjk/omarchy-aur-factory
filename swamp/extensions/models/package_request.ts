/**
 * Package request lifecycle model.
 *
 * The data layer of the omarchy package-request web application. Each request
 * is one resource instance (request-<pkgname>) whose status advances:
 *
 *   requested → approved → unstable → stable   (or → rejected)
 *
 * - `submit`: a user files a new package request.
 * - `approve` / `reject`: a maintainer rules on a requested package.
 * - `mark-built`: the packaging factory records a successful build, moving the
 *   package to the unstable channel.
 * - `approve-promotion`: maintainer and user each approve an unstable package;
 *   when both approvals are present the status becomes stable.
 *
 * Every transition appends to the request's history, and swamp's data
 * versioning keeps the full audit trail.
 *
 * @module
 */
// extensions/models/package_request.ts
import { z } from "npm:zod@4";

const GlobalArgsSchema = z.object({});
type GlobalArgs = z.infer<typeof GlobalArgsSchema>;

const ApprovalSchema = z.object({
  by: z.string(),
  at: z.iso.datetime(),
});

const HistoryEntrySchema = z.object({
  at: z.iso.datetime(),
  event: z.string(),
  by: z.string(),
  detail: z.string(),
});

const RequestSchema = z.object({
  pkgname: z.string(),
  url: z.string(),
  description: z.string(),
  license: z.string(),
  status: z.enum(["requested", "approved", "rejected", "unstable", "stable"]),
  submittedBy: z.string(),
  version: z.string(),
  maintainerApproval: ApprovalSchema.nullable(),
  promotionMaintainer: ApprovalSchema.nullable(),
  promotionUser: ApprovalSchema.nullable(),
  rejectionReason: z.string(),
  history: z.array(HistoryEntrySchema),
  updatedAt: z.iso.datetime(),
});
type Request = z.infer<typeof RequestSchema>;

const SubmitArgsSchema = z.object({
  pkgname: z.string().describe("Package name being requested"),
  url: z.string().describe("Upstream source URL"),
  description: z.string().describe("Short package description"),
  license: z.string().describe("License (SPDX identifier)"),
  submitter: z.string().describe("Who is submitting the request"),
});
type SubmitArgs = z.infer<typeof SubmitArgsSchema>;

const RuleArgsSchema = z.object({
  pkgname: z.string().describe("Package the ruling applies to"),
  approver: z.string().describe("Maintainer making the ruling"),
  reason: z.string().default("").describe("Reason (required for reject)"),
});
type RuleArgs = z.infer<typeof RuleArgsSchema>;

const BuiltArgsSchema = z.object({
  pkgname: z.string().describe("Package that was built"),
  version: z.string().describe("Built version <pkgver>-<pkgrel>"),
});
type BuiltArgs = z.infer<typeof BuiltArgsSchema>;

const PromoteArgsSchema = z.object({
  pkgname: z.string().describe("Unstable package being approved for promotion"),
  approver: z.string().describe("Who is approving"),
  role: z.enum(["maintainer", "user"]).describe("Approval role; both roles are needed for stable"),
});
type PromoteArgs = z.infer<typeof PromoteArgsSchema>;

type WriteResourceFn = (
  specName: string,
  name: string,
  data: Record<string, unknown>,
) => Promise<{ name: string }>;
type ReadResourceFn = (name: string) => Promise<Record<string, unknown> | null>;
type Logger = { info: (msg: string, props?: Record<string, unknown>) => void };

function historyEntry(event: string, by: string, detail = ""): z.infer<typeof HistoryEntrySchema> {
  return { at: new Date().toISOString(), event, by, detail };
}

async function loadRequest(read: ReadResourceFn, pkgname: string): Promise<Request> {
  const data = await read(`request-${pkgname}`) as Request | null;
  if (!data) throw new Error(`No request exists for package '${pkgname}'`);
  return data;
}

async function saveRequest(
  write: WriteResourceFn,
  req: Request,
): Promise<{ name: string }> {
  req.updatedAt = new Date().toISOString();
  return await write("request", `request-${req.pkgname}`, req);
}

/** Package request lifecycle: submit, maintainer approval, build recording, and unstable→stable promotion. */
export const model = {
  type: "@omarchy/package-request",
  version: "2026.09.03.1",
  globalArguments: GlobalArgsSchema,
  resources: {
    "request": {
      description: "One package request and its full lifecycle (instance: request-<pkgname>)",
      schema: RequestSchema,
      lifetime: "infinite",
      garbageCollection: 50,
    },
  },
  methods: {
    submit: {
      description: "File a new package request (status: requested)",
      arguments: SubmitArgsSchema,
      execute: async (
        args: SubmitArgs,
        context: {
          globalArgs: GlobalArgs;
          logger: Logger;
          readResource: ReadResourceFn;
          writeResource: WriteResourceFn;
        },
      ) => {
        const existing = await context.readResource(`request-${args.pkgname}`) as Request | null;
        if (existing && existing.status !== "rejected") {
          throw new Error(
            `Request for '${args.pkgname}' already exists with status '${existing.status}'`,
          );
        }
        const req: Request = {
          pkgname: args.pkgname,
          url: args.url,
          description: args.description,
          license: args.license,
          status: "requested",
          submittedBy: args.submitter,
          version: "",
          maintainerApproval: null,
          promotionMaintainer: null,
          promotionUser: null,
          rejectionReason: "",
          history: [
            ...(existing?.history ?? []),
            historyEntry("submitted", args.submitter, `${args.url} (${args.license})`),
          ],
          updatedAt: new Date().toISOString(),
        };
        context.logger.info("request submitted: {pkgname}", { pkgname: args.pkgname });
        return { dataHandles: [await saveRequest(context.writeResource, req)] };
      },
    },
    approve: {
      description: "Maintainer approves a requested package (status: requested → approved)",
      arguments: RuleArgsSchema,
      execute: async (
        args: RuleArgs,
        context: {
          globalArgs: GlobalArgs;
          logger: Logger;
          readResource: ReadResourceFn;
          writeResource: WriteResourceFn;
        },
      ) => {
        const req = await loadRequest(context.readResource, args.pkgname);
        if (req.status !== "requested") {
          throw new Error(`Cannot approve '${args.pkgname}': status is '${req.status}', not 'requested'`);
        }
        req.status = "approved";
        req.maintainerApproval = { by: args.approver, at: new Date().toISOString() };
        req.history.push(historyEntry("approved", args.approver, args.reason));
        context.logger.info("request approved: {pkgname} by {approver}", {
          pkgname: args.pkgname,
          approver: args.approver,
        });
        return { dataHandles: [await saveRequest(context.writeResource, req)] };
      },
    },
    reject: {
      description: "Maintainer rejects a requested package (status: requested → rejected)",
      arguments: RuleArgsSchema,
      execute: async (
        args: RuleArgs,
        context: {
          globalArgs: GlobalArgs;
          logger: Logger;
          readResource: ReadResourceFn;
          writeResource: WriteResourceFn;
        },
      ) => {
        const req = await loadRequest(context.readResource, args.pkgname);
        if (req.status !== "requested") {
          throw new Error(`Cannot reject '${args.pkgname}': status is '${req.status}', not 'requested'`);
        }
        if (!args.reason) throw new Error("A reason is required to reject a request");
        req.status = "rejected";
        req.rejectionReason = args.reason;
        req.history.push(historyEntry("rejected", args.approver, args.reason));
        return { dataHandles: [await saveRequest(context.writeResource, req)] };
      },
    },
    "record-retry": {
      description: "Record a maintainer's build-retry request with hints (status must be approved)",
      arguments: z.object({
        pkgname: z.string().describe("Package being retried"),
        requestedBy: z.string().describe("Maintainer requesting the retry"),
        hint: z.string().describe("Hints for the next authoring attempt"),
      }),
      execute: async (
        args: { pkgname: string; requestedBy: string; hint: string },
        context: {
          globalArgs: GlobalArgs;
          logger: Logger;
          readResource: ReadResourceFn;
          writeResource: WriteResourceFn;
        },
      ) => {
        const req = await loadRequest(context.readResource, args.pkgname);
        if (req.status !== "approved") {
          throw new Error(
            `Cannot retry build for '${args.pkgname}': status is '${req.status}', not 'approved'`,
          );
        }
        req.history.push(historyEntry("retry-requested", args.requestedBy, args.hint));
        return { dataHandles: [await saveRequest(context.writeResource, req)] };
      },
    },
    "mark-built": {
      description: "Record a successful factory build (status: approved → unstable)",
      arguments: BuiltArgsSchema,
      execute: async (
        args: BuiltArgs,
        context: {
          globalArgs: GlobalArgs;
          logger: Logger;
          readResource: ReadResourceFn;
          writeResource: WriteResourceFn;
        },
      ) => {
        const req = await loadRequest(context.readResource, args.pkgname);
        if (req.status !== "approved") {
          throw new Error(
            `Cannot mark '${args.pkgname}' built: status is '${req.status}', not 'approved'`,
          );
        }
        req.status = "unstable";
        req.version = args.version;
        req.history.push(historyEntry("built", "factory", `version ${args.version} → unstable channel`));
        return { dataHandles: [await saveRequest(context.writeResource, req)] };
      },
    },
    "approve-promotion": {
      description:
        "Record a maintainer or user promotion approval; both roles present moves unstable → stable",
      arguments: PromoteArgsSchema,
      execute: async (
        args: PromoteArgs,
        context: {
          globalArgs: GlobalArgs;
          logger: Logger;
          readResource: ReadResourceFn;
          writeResource: WriteResourceFn;
        },
      ) => {
        const req = await loadRequest(context.readResource, args.pkgname);
        if (req.status !== "unstable") {
          throw new Error(
            `Cannot approve promotion for '${args.pkgname}': status is '${req.status}', not 'unstable'`,
          );
        }
        const approval = { by: args.approver, at: new Date().toISOString() };
        if (args.role === "maintainer") req.promotionMaintainer = approval;
        else req.promotionUser = approval;
        req.history.push(historyEntry("promotion-approval", args.approver, `role: ${args.role}`));
        if (req.promotionMaintainer && req.promotionUser) {
          req.status = "stable";
          req.history.push(historyEntry("promoted", "system", "both approvals present → stable"));
        }
        context.logger.info("promotion approval: {pkgname} {role} → {status}", {
          pkgname: args.pkgname,
          role: args.role,
          status: req.status,
        });
        return { dataHandles: [await saveRequest(context.writeResource, req)] };
      },
    },
  },
};
