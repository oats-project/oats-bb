#!/usr/bin/env node
// A mock of an OpenAI-compatible chat endpoint for the pi run (README.md beside this file): pi in
// a bb thread talks to it instead of a model, so the run needs no login and spends nothing. bb's
// pi finds it as the provider `mock` of its pi configuration (setup.sh writes models.json), with
// one model, `echo`: a launch on it names the model `mock/echo`.
//
//   node mock-openai.mjs <directory> [port]
//
// It answers every chat request with one line of text, and asks for one tool only where a
// person's message says so: where the last message of the conversation is a person's and holds a
// line `MOCK-CALL:<json>`, with <json> `{"name": <tool>, "arguments": {…}}`, and the request
// offers that tool, the answer is a call of it with those arguments. The request that brings the
// tool's result back has that result as its last message, and is answered with the one line of
// text.
// Every request is one line of <directory>/pi-requests.jsonl.
import { appendFileSync, mkdirSync } from "node:fs";
import { createServer } from "node:http";
import { join } from "node:path";

const directory = process.argv[2];
const port = Number(process.argv[3] ?? 9998);
if (!directory) {
  console.error("usage: mock-openai.mjs <directory> [port]");
  process.exit(2);
}
mkdirSync(directory, { recursive: true });
const log = join(directory, "pi-requests.jsonl");
let count = 0;

const textOf = (content) =>
  typeof content === "string" ? content : Array.isArray(content) ? content.map((part) => (typeof part?.text === "string" ? part.text : "")).join("\n") : "";

createServer((request, response) => {
  let body = "";
  request.on("data", (chunk) => (body += chunk));
  request.on("end", () => {
    count += 1;
    const n = count;
    let asked = {};
    try {
      asked = JSON.parse(body);
    } catch {
      // not a JSON body (a GET): answered below as a model list
    }
    const messages = Array.isArray(asked.messages) ? asked.messages : [];
    const tools = (asked.tools ?? []).map((tool) => tool.function?.name ?? tool.name);
    const lastMessage = messages[messages.length - 1];
    // The last message as the person wrote it: a tool's result asks for nothing.
    const last = lastMessage?.role === "user" ? textOf(lastMessage.content) : "";
    const asking = /^MOCK-CALL:(\{.*\})$/m.exec(last);
    let call = null;
    if (asking) {
      try {
        const named = JSON.parse(asking[1]);
        if (typeof named.name === "string" && tools.includes(named.name)) call = { name: named.name, arguments: JSON.stringify(named.arguments ?? {}) };
      } catch {
        // not JSON: answered with the line of text
      }
    }
    const chat = request.url.includes("chat/completions");
    appendFileSync(
      log,
      `${JSON.stringify({
        n,
        at: new Date().toISOString(),
        method: request.method,
        url: request.url,
        model: asked.model,
        messages: messages.length,
        tools: tools.length,
        lastRole: lastMessage?.role ?? null,
        // What the turn was asked, and what a tool answered: the run's checks read both.
        lastText: textOf(lastMessage?.content).slice(-2000),
        system: textOf(messages[0]?.role === "system" || messages[0]?.role === "developer" ? messages[0].content : "").length,
        event: !chat ? "listed" : call === null ? "answered" : `called ${call.name}`,
      })}\n`,
    );
    if (!chat) {
      response.writeHead(200, { "content-type": "application/json" });
      return response.end(JSON.stringify({ object: "list", data: [{ id: "echo", object: "model" }] }));
    }
    response.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
    const base = { id: `chatcmpl-mock${n}`, object: "chat.completion.chunk", created: Math.floor(Date.now() / 1000), model: "echo" };
    const send = (chunk) => response.write(`data: ${JSON.stringify({ ...base, ...chunk })}\n\n`);
    const usage = { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 };
    if (call === null) {
      send({ choices: [{ index: 0, delta: { role: "assistant", content: `MOCK-REPLY ${n}` }, finish_reason: null }] });
      send({ choices: [{ index: 0, delta: {}, finish_reason: "stop" }], usage });
    } else {
      send({ choices: [{ index: 0, delta: { role: "assistant", tool_calls: [{ index: 0, id: `call_mock${n}`, type: "function", function: call }] }, finish_reason: null }] });
      send({ choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }], usage });
    }
    response.write("data: [DONE]\n\n");
    response.end();
  });
}).listen(port, "127.0.0.1", () => console.log(`mock model for pi on 127.0.0.1:${port}`));
