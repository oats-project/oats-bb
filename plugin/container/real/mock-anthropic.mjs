#!/usr/bin/env node
// A mock of Anthropic's Messages endpoint for the real run (container/real/README.md): Claude Code
// in a bb thread talks to it instead of a model, so the run needs no login and spends nothing.
// It answers every model request with one line of text, and never asks for a tool.
//
//   node mock-anthropic.mjs <directory> [port]
//
// A turn can be held open, which is what makes an agent read "working" for as long as a check
// needs: a request whose conversation holds the text `MOCK-HOLD:<name>` is not answered while the
// file <directory>/hold/<name> exists. Remove the file and the turn ends. Requests that offer no
// tools (bb's title generation) and token counts are answered at once.
// Every request is one line of <directory>/requests.jsonl.
import { appendFileSync, existsSync, mkdirSync } from "node:fs";
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
    record({ event: "answered" });

    const id = `msg_mock${n}`;
    const text = `MOCK-REPLY ${n}`;
    const usage = { input_tokens: 10, output_tokens: 5, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 };
    if (!asked.stream) {
      return json(200, { id, type: "message", role: "assistant", model: asked.model, content: [{ type: "text", text }], stop_reason: "end_turn", stop_sequence: null, usage });
    }
    response.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
    const event = (name, data) => response.write(`event: ${name}\ndata: ${JSON.stringify(data)}\n\n`);
    event("message_start", { type: "message_start", message: { id, type: "message", role: "assistant", model: asked.model, content: [], stop_reason: null, stop_sequence: null, usage } });
    event("content_block_start", { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } });
    event("content_block_delta", { type: "content_block_delta", index: 0, delta: { type: "text_delta", text } });
    event("content_block_stop", { type: "content_block_stop", index: 0 });
    event("message_delta", { type: "message_delta", delta: { stop_reason: "end_turn", stop_sequence: null }, usage: { output_tokens: 5 } });
    event("message_stop", { type: "message_stop" });
    response.end();
  });
}).listen(port, "127.0.0.1", () => console.log(`mock model on 127.0.0.1:${port}, holds in ${holds}`));
