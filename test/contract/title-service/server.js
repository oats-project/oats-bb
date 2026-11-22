// A bb plugin for test/contract/title.test.mjs, and nothing of the provider's: one AI
// service of bb's (`bb.experimental_aiServices`), which stands for the one that writes
// bb's thread titles where a person is signed in (bb cloud; bb's Codex plugin). The
// contract container has neither, so without this bb generates no title there, and what
// bb does with a generated title could not be pinned.
//
// It answers every request with one fixed title, and appends the prompt bb sent to
// ASKED: how many titles bb asked for, and for which thread's task.
import { appendFileSync } from "node:fs";

const ASKED = "/home/node/title-service-asked.jsonl";
export const TITLE = "A title bb wrote";

export default function plugin(bb) {
  bb.experimental_aiServices.register({
    id: "fixed",
    displayName: "Fixed title",
    complete: async (prompt) => {
      appendFileSync(ASKED, `${JSON.stringify({ prompt })}\n`);
      return TITLE;
    },
  });
}
