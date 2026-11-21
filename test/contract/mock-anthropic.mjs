// Mock Anthropic Messages endpoint (extends the pi trial's mock.mjs): logs every request with the
// caller's pid hint, replies with text, or with one scripted Bash tool_use when armed.
// Arm: write a shell command into /home/node/mock-next-cmd; the next request that offers a Bash
// tool and whose last message is not a tool_result consumes it.
import http from 'node:http'; import fs from 'node:fs';
const LOG = '/home/node/mock-requests.jsonl', CMD = '/home/node/mock-next-cmd';
let n = 0;
const textOf = c => typeof c === 'string' ? c : (c || []).map(b => b.type === 'text' ? b.text : b.type === 'tool_result' ? '[tool_result] ' + JSON.stringify(b.content).slice(0, 400) : '[' + b.type + ']').join('\n');
http.createServer((req, res) => {
  let body = ''; req.on('data', c => body += c); req.on('end', () => {
    n++;
    let j = {}; try { j = JSON.parse(body); } catch {}
    const msgs = j.messages || [];
    const last = msgs[msgs.length - 1] || {};
    const lastIsToolResult = Array.isArray(last.content) && last.content.some(b => b.type === 'tool_result');
    const tools = (j.tools || []).map(t => t.name);
    const sys = Array.isArray(j.system) ? j.system.map(s => s.text).join('\n') : (j.system || '');
    const rec = { n, at: new Date().toISOString(), url: req.url, ua: req.headers['user-agent'], model: j.model, nmsgs: msgs.length, tools, sysLen: sys.length, lastRole: last.role, lastText: textOf(last.content).slice(-3000) };
    fs.appendFileSync(LOG, JSON.stringify(rec) + '\n');
    fs.writeFileSync('/home/node/mock-req-' + n + '.json', body);
    if (!req.url.startsWith('/v1/messages') || req.url.includes('count_tokens')) {
      res.writeHead(200, { 'content-type': 'application/json' });
      if (req.url.includes('count_tokens')) return res.end(JSON.stringify({ input_tokens: 10 }));
      return res.end(JSON.stringify({ data: [{ type: 'model', id: 'claude-opus-5-5', display_name: 'mock' }], has_more: false }));
    }
    if (fs.existsSync('/home/node/mock-error') && req.url.startsWith('/v1/messages') && !req.url.includes('count_tokens')) { res.writeHead(400, { 'content-type': 'application/json' }); return res.end(JSON.stringify({ type: 'error', error: { type: 'invalid_request_error', message: 'MOCK forced error' } })); }
    let tool = null;
    if (!lastIsToolResult && tools.includes('Bash') && fs.existsSync(CMD)) { tool = fs.readFileSync(CMD, 'utf8').trim(); fs.unlinkSync(CMD); const all = JSON.stringify(msgs); const m = [...all.matchAll(/message_id=\\"([0-9a-f-]{36})/g)].pop() || [...all.matchAll(/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/g)].pop(); tool = tool.replace('{{MID}}', m ? m[1] : 'NO-MID'); }
    const id = 'msg_mock' + n;
    const usage = { input_tokens: 10, output_tokens: 5, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 };
    let tname = 'Bash', tinput = { command: tool, description: 'scripted' };
    if (tool && tool.startsWith('{')) { const o = JSON.parse(tool); tname = o.tool; tinput = o.input; }
    // Claude Code's auto mode asks a classifier, in a request of its own with no tools,
    // to grade the action ("Respond with <severity>N</severity>"). Unless the test arms a
    // grade (/home/node/mock-severity), the mock grades every action harmless: what a
    // classifier that does not flag an action answers.
    const grading = tools.length === 0 && textOf(last.content).includes('<severity>N</severity>');
    const severity = fs.existsSync('/home/node/mock-severity') ? fs.readFileSync('/home/node/mock-severity', 'utf8').trim() : '0';
    const blocks = tool ? [{ type: 'tool_use', id: 'toolu_mock' + n, name: tname, input: tinput }] : [{ type: 'text', text: grading ? `<severity>${severity}</severity>` : 'MOCK-REPLY ' + n }];
    if (!j.stream) {
      res.writeHead(200, { 'content-type': 'application/json' });
      return res.end(JSON.stringify({ id, type: 'message', role: 'assistant', model: j.model, content: blocks, stop_reason: tool ? 'tool_use' : 'end_turn', stop_sequence: null, usage }));
    }
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
    const ev = (e, d) => res.write('event: ' + e + '\ndata: ' + JSON.stringify(d) + '\n\n');
    ev('message_start', { type: 'message_start', message: { id, type: 'message', role: 'assistant', model: j.model, content: [], stop_reason: null, stop_sequence: null, usage } });
    blocks.forEach((b, i) => {
      if (b.type === 'text') {
        ev('content_block_start', { type: 'content_block_start', index: i, content_block: { type: 'text', text: '' } });
        ev('content_block_delta', { type: 'content_block_delta', index: i, delta: { type: 'text_delta', text: b.text } });
      } else {
        ev('content_block_start', { type: 'content_block_start', index: i, content_block: { type: 'tool_use', id: b.id, name: b.name, input: {} } });
        ev('content_block_delta', { type: 'content_block_delta', index: i, delta: { type: 'input_json_delta', partial_json: JSON.stringify(b.input) } });
      }
      ev('content_block_stop', { type: 'content_block_stop', index: i });
    });
    ev('message_delta', { type: 'message_delta', delta: { stop_reason: tool ? 'tool_use' : 'end_turn', stop_sequence: null }, usage: { output_tokens: 5 } });
    ev('message_stop', { type: 'message_stop' });
    res.end();
  });
}).listen(9999, '127.0.0.1', () => console.log('mock on 9999'));
