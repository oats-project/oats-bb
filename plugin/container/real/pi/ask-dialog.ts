// For the pi run only (README.md beside this file): a tool that opens one of pi's blocking
// extension dialogs. pi has no permission prompts; a dialog an extension opens (ctx.ui.confirm,
// select, input, editor) is what waits on a person in a pi thread. bb shows it as a pending
// interaction, and the OATS bridge for pi sets a `question` claim while it is open.
// (After the provider's contract test's own, test/contract/pi/contract-dialog.ts.)
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

export default function (pi: ExtensionAPI) {
  pi.registerTool({
    name: "ask_person",
    label: "Ask the person",
    description: "Ask the person to confirm (the pi run of the OATS plugin for bb).",
    parameters: Type.Object({ title: Type.String(), question: Type.String() }),
    async execute(_id, params, _signal, _onUpdate, ctx) {
      const ok = await ctx.ui.confirm(params.title, params.question);
      return { content: [{ type: "text", text: `the person answered: ${ok}` }], details: {} };
    },
  });
}
