#!/usr/bin/env node
// A mock of Anthropic's Messages endpoint for the real run (container/real/README.md): Claude Code
// in a bb thread talks to it instead of a model, so the run needs no login and spends nothing.
// It answers every model request with one line of text, and asks for one tool only where a
// message says so (MOCK-ASK, below).
//
//   node mock-anthropic.mjs <directory> [port]
//
// A turn can be held open, which is what makes an agent read "working" for as long as a check
// needs: a request whose conversation holds the text `MOCK-HOLD:<name>` is not answered while the
// file <directory>/hold/<name> exists. Remove the file and the turn ends. Requests that offer no
// tools (bb's title generation) and token counts are answered at once.
// A question: where the last message of the conversation is a person's and holds a line
// `MOCK-ASK:<json>`, and the request offers the tool AskUserQuestion, the answer is a call of that
// tool with <json> as its input (`{"questions": [{"question", "header", "options", "multiSelect"}]}`).
// The request that brings the tool's result back has that result as its last message, and is
// answered with the one line of text.
// A long answer (the busy workspace's chat: paragraphs, a list, a code block): where the file
// <directory>/say.json is, `{ "<a person's message>": "<the answer>" }`, and what the
// person said since the model last spoke holds one of its messages, the answer is that text instead of
// the one line. The file is read at each request: whoever needs it writes it, and removes it.
// Every request is one line of <directory>/requests.jsonl.
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { createServer } from "node:http";
import { join } from "node:path";

const directory = process.argv[2];
const port = Number(process.argv[3] ?? 9999);
if (!directory) {
  console.error("usage: mock-anthropic.mjs <directory> [port]");
  process.exit(2);
}
const holds = join(directory, "hold");
mkdirSync(holds, { recursive: true });
const log = join(directory, "requests.jsonl");
let count = 0;

const says = join(directory, "say.json");
/** The answer say.json gives to a person's message, or null (no file, not JSON, no message of it in `last`). */
function sayTo(last) {
  if (last === "" || !existsSync(says)) return null;
  try {
    const found = Object.entries(JSON.parse(readFileSync(says, "utf8"))).find(([message]) => message !== "" && last.includes(message));
    return found !== undefined && typeof found[1] === "string" ? found[1] : null;
  } catch {
    return null; // a file half written or not JSON: the one line
  }
}

const ASK_TOOL = "AskUserQuestion";
const textOf = (content) =>
  typeof content === "string" ? content : (content ?? []).map((block) => (block.type === "text" ? block.text : "")).join("\n");

/** Resolves once no hold file of the conversation is left, or when the client is gone. */
function released(names, gone) {
  return new Promise((resolve) => {
    const check = () => {
      if (gone() || names.every((name) => !existsSync(join(holds, name)))) {
        clearInterval(timer);
        resolve();
      }
    };
    const timer = setInterval(check, 200);
    check();
  });
}

createServer((request, response) => {
  let body = "";
  // The client went away before an answer (bb stopped the thread, or Claude gave up).
  let abandoned = false;
  response.on("close", () => (abandoned = !response.writableEnded));
  request.on("data", (chunk) => (body += chunk));
  request.on("end", async () => {
    count += 1;
    const n = count;
    let asked = {};
    try {
      asked = JSON.parse(body);
    } catch {
      // not a JSON body (a GET): answered below as a model list
    }
    const messages = asked.messages ?? [];
    const tools = (asked.tools ?? []).map((tool) => tool.name);
    const said = messages.map((message) => textOf(message.content)).join("\n");
    // The last message as the person wrote it: a tool's result is no text, so it asks nothing.
    const last = messages.length > 0 && messages[messages.length - 1].role === "user" ? textOf(messages[messages.length - 1].content) : "";
    const asking = tools.includes(ASK_TOOL) ? /^MOCK-ASK:(\{.*\})$/m.exec(last) : null;
    let question = null;
    if (asking) {
      try {
        question = JSON.parse(asking[1]);
      } catch {
        // not JSON: answered with the line of text
      }
    }
    const names = tools.length === 0 ? [] : [...new Set([...said.matchAll(/MOCK-HOLD:([a-z0-9-]+)/g)].map((match) => match[1]))];
    const json = (status, value) => {
      response.writeHead(status, { "content-type": "application/json" });
      response.end(JSON.stringify(value));
    };
    const record = (extra) =>
      appendFileSync(log, `${JSON.stringify({ n, at: new Date().toISOString(), method: request.method, url: request.url, model: asked.model, messages: messages.length, tools: tools.length, holds: names, ...extra })}\n`);
    record({ event: "asked" });

    if (request.url.includes("count_tokens")) return json(200, { input_tokens: 10 });
    if (!request.url.startsWith("/v1/messages")) return json(200, { data: [{ type: "model", id: "claude-opus-5-5", display_name: "mock" }], has_more: false });

    await released(names, () => abandoned);
    if (abandoned) return record({ event: "abandoned" });
    record({ event: question === null ? "answered" : "asked-a-question" });

    const id = `msg_mock${n}`;
    // What the person said since the model last spoke (a harness may add a message of its own after the person's).
    const since = messages.slice(messages.findLastIndex((message) => message.role === "assistant") + 1).filter((message) => message.role === "user").map((message) => textOf(message.content)).join("\n");
    const text = (tools.length === 0 ? null : sayTo(since)) ?? `MOCK-REPLY ${n}`;
    const usage = { input_tokens: 10, output_tokens: 5, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 };
    const call = { type: "tool_use", id: `toolu_mock${n}`, name: ASK_TOOL };
    if (!asked.stream) {
      const content = question === null ? [{ type: "text", text }] : [{ ...call, input: question }];
      return json(200, { id, type: "message", role: "assistant", model: asked.model, content, stop_reason: question === null ? "end_turn" : "tool_use", stop_sequence: null, usage });
    }
    response.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
    const event = (name, data) => response.write(`event: ${name}\ndata: ${JSON.stringify(data)}\n\n`);
    event("message_start", { type: "message_start", message: { id, type: "message", role: "assistant", model: asked.model, content: [], stop_reason: null, stop_sequence: null, usage } });
    if (question === null) {
      event("content_block_start", { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } });
      event("content_block_delta", { type: "content_block_delta", index: 0, delta: { type: "text_delta", text } });
    } else {
      event("content_block_start", { type: "content_block_start", index: 0, content_block: { ...call, input: {} } });
      event("content_block_delta", { type: "content_block_delta", index: 0, delta: { type: "input_json_delta", partial_json: JSON.stringify(question) } });
    }
    event("content_block_stop", { type: "content_block_stop", index: 0 });
    event("message_delta", { type: "message_delta", delta: { stop_reason: question === null ? "end_turn" : "tool_use", stop_sequence: null }, usage: { output_tokens: 5 } });
    event("message_stop", { type: "message_stop" });
    response.end();
  });
}).listen(port, "127.0.0.1", () => console.log(`mock model on 127.0.0.1:${port}, holds in ${holds}`));
