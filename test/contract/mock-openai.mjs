// Mock OpenAI-compatible chat endpoint for the pi contract test (after the pi harness
// probe's mock): logs every request, replies with text, or with one scripted tool call.
// On port 9998, with file names of its own: it runs beside the Anthropic mock (9999).
//
//   ~/pi-mock-requests.jsonl   one line per request: {n, url, tools, nmsgs, lastRole, lastText, users, sys}
//   ~/pi-mock-next-cmd      arms the next reply: a plain line is a `bash` call with that command;
//                           {"name": .., "arguments": {..}} is that tool call. Consumed by the next
//                           request whose last message is not a tool result.
//   ~/pi-mock-error         while it exists, every chat request answers HTTP 400: a failed turn.
import http from "node:http";
import fs from "node:fs";

const HOME = "/home/node";
const LOG = `${HOME}/pi-mock-requests.jsonl`, NEXT = `${HOME}/pi-mock-next-cmd`, FAIL = `${HOME}/pi-mock-error`;
let n = 0;
const text = (message) => (typeof message?.content === "string" ? message.content : JSON.stringify(message?.content ?? ""));

http.createServer((req, res) => {
  let body = "";
  req.on("data", (chunk) => { body += chunk; });
  req.on("end", () => {
    n += 1;
    let parsed = {};
    try { parsed = JSON.parse(body); } catch { /* logged as an empty request */ }
    const messages = Array.isArray(parsed.messages) ? parsed.messages : [];
    const last = messages[messages.length - 1] ?? {};
    const tools = (parsed.tools ?? []).map((tool) => tool.function?.name ?? tool.name);
    fs.appendFileSync(LOG, `${JSON.stringify({
      n, at: new Date().toISOString(), url: req.url, tools, nmsgs: messages.length, lastRole: last.role ?? null, lastText: text(last).slice(-3000),
      users: messages.filter((message) => message.role === "user").map((message) => text(message).slice(0, 400)),
      sys: text(messages[0]),
    })}\n`);
    if (!req.url.includes("chat/completions")) {
      res.writeHead(200, { "content-type": "application/json" });
      return res.end(JSON.stringify({ data: [{ id: "echo", object: "model" }] }));
    }
    if (fs.existsSync(FAIL)) {
      res.writeHead(400, { "content-type": "application/json" });
      return res.end(JSON.stringify({ error: { message: "MOCK forced error", type: "invalid_request_error" } }));
    }
    let tool = null;
    if (last.role !== "tool" && fs.existsSync(NEXT)) {
      const raw = fs.readFileSync(NEXT, "utf8").trim();
      fs.unlinkSync(NEXT);
      try { const call = JSON.parse(raw); tool = { name: call.name, arguments: JSON.stringify(call.arguments ?? {}) }; }
      catch { tool = { name: "bash", arguments: JSON.stringify({ command: raw }) }; }
    }
    res.writeHead(200, { "content-type": "text/event-stream" });
    const send = (chunk) => res.write(`data: ${JSON.stringify(chunk)}\n\n`);
    const base = { id: `mock${n}`, object: "chat.completion.chunk", created: Math.floor(Date.now() / 1000), model: "echo" };
    const usage = { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 };
    if (tool) {
      send({ ...base, choices: [{ index: 0, delta: { role: "assistant", tool_calls: [{ index: 0, id: `call_${n}`, type: "function", function: tool }] }, finish_reason: null }] });
      send({ ...base, choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }], usage });
    } else {
      send({ ...base, choices: [{ index: 0, delta: { role: "assistant", content: `MOCK-REPLY ${n}` }, finish_reason: null }] });
      send({ ...base, choices: [{ index: 0, delta: {}, finish_reason: "stop" }], usage });
    }
    res.write("data: [DONE]\n\n");
    res.end();
  });
}).listen(9998, "127.0.0.1", () => console.log("mock on 9998"));
