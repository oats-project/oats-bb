// Contract test only (test/contract/pi.test.mjs): a tool that opens one of pi's blocking
// extension dialogs. pi has no permission prompts; a dialog an extension opens
// (ctx.ui.confirm, select, input, editor) is what waits on a person in a pi thread, and bb
// shows it as a pending interaction.
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

export default function (pi: ExtensionAPI) {
  pi.registerTool({
    name: "contract_confirm",
    label: "Contract confirm",
    description: "Ask the person to confirm (contract test).",
    parameters: Type.Object({}),
    async execute(_id, _params, _signal, _onUpdate, ctx) {
      const ok = await ctx.ui.confirm("Contract question", "Allow the contract test to continue?");
      return { content: [{ type: "text", text: `confirm answered: ${ok}` }], details: {} };
    },
  });
}
