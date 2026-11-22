// Outside OATS: what the kernel's status rows say of an agent that something happened to outside
// OATS (a session OATS lost, a harness that runs in a home OATS stopped). One read, no host verb:
// the server answers it from the one status read it already keeps.
import { defineRpcContract } from "@get-bb/plugin-sdk";
import { z } from "zod";
import { outsideRow } from "../kernel/outside.js";

/**
 * By instance, for the roster read at `at`: how its session ended and the kernel's `outsideOats`
 * report. `feature`: whether the kernel lists `provider-outside-oats`; where it does not, every
 * `outsideOats` is null and its absence says nothing.
 */
export const outsideFacts = z.object({ at: z.string(), feature: z.boolean(), rows: z.array(outsideRow) });

/** app -> server */
export const rpc = defineRpcContract({
  outsideFacts: { input: z.null(), output: outsideFacts },
});

/** server -> host: none. */
export const host = defineRpcContract({});
