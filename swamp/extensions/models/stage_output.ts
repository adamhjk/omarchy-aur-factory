/**
 * Stage output channel.
 *
 * Receives structured output from child Claude calls (review verdicts, fix
 * reports, ...) directly as swamp data, replacing scratch-file IPC. A child
 * records with:
 *
 *   swamp model @omarchy/stage-output method run record stage-output \
 *     --input kind=review --input key=<work-item>-r1 --input nonce=<nonce> \
 *     --input 'payload={"verdict":...}'
 *
 * and the invoking factory method reads `record-<kind>-<key>` back, verifying
 * the nonce it minted for that invocation. The payload must be valid JSON —
 * invalid payloads fail the record call inside the child's session, where the
 * child can correct and retry.
 *
 * This model is deliberately separate from the factory models: a factory
 * method holds its own model's lock while running, so children must write
 * through a different model.
 *
 * @module
 */
// extensions/models/stage_output.ts
import { z } from "npm:zod@4";

const GlobalArgsSchema = z.object({});
type GlobalArgs = z.infer<typeof GlobalArgsSchema>;

const RecordSchema = z.object({
  kind: z.string(),
  key: z.string(),
  nonce: z.string(),
  payload: z.looseObject({}),
  timestamp: z.iso.datetime(),
});

const RecordArgsSchema = z.object({
  kind: z.string().describe("What kind of stage output this is: review | fix | work | ..."),
  key: z.string().describe("Output key, e.g. <work-item>-r1"),
  nonce: z.string().describe("Nonce given by the invoking factory method; ties the record to one invocation"),
  payload: z.string().describe("The structured output as a JSON object string"),
});
type RecordArgs = z.infer<typeof RecordArgsSchema>;

/** Receives structured stage output from child Claude calls as swamp data (instance: record-<kind>-<key>). */
export const model = {
  type: "@omarchy/stage-output",
  version: "2026.09.03.1",
  globalArguments: GlobalArgsSchema,
  resources: {
    "record": {
      description: "One structured stage output (instance: record-<kind>-<key>)",
      schema: RecordSchema,
      lifetime: "infinite",
      garbageCollection: 20,
    },
  },
  methods: {
    record: {
      description: "Record structured stage output (payload must be a valid JSON object)",
      arguments: RecordArgsSchema,
      execute: async (
        args: RecordArgs,
        context: {
          globalArgs: GlobalArgs;
          writeResource: (
            specName: string,
            name: string,
            data: Record<string, unknown>,
          ) => Promise<{ name: string }>;
        },
      ) => {
        let payload: unknown;
        try {
          payload = JSON.parse(args.payload);
        } catch (err) {
          throw new Error(`payload is not valid JSON: ${err}`);
        }
        if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
          throw new Error("payload must be a JSON object");
        }
        const handle = await context.writeResource("record", `record-${args.kind}-${args.key}`, {
          kind: args.kind,
          key: args.key,
          nonce: args.nonce,
          payload,
          timestamp: new Date().toISOString(),
        });
        return { dataHandles: [handle] };
      },
    },
  },
};
