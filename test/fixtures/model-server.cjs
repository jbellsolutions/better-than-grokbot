// Deterministic, local inference for browser verification. Never calls a provider or computer.
const http = require('node:http');
let sequence = 0;
// Which tool each call this server made was (a follow-up request may carry only the call's output).
const calls = new Map();
const server = http.createServer(async (req, res) => {
  if (req.method !== 'POST' || req.url !== '/v1/responses') { res.writeHead(404); res.end(); return; }
  let raw = ''; for await (const chunk of req) raw += chunk;
  const body = JSON.parse(raw);
  const input = body.input || [];
  const id = 'fixture-' + ++sequence;
  const toolOutput = input.find(m => m.type === 'function_call_output');
  const latest = [...input].reverse().find(m => m.role === 'user');
  if (process.env.FIXTURE_LOG && input.some(m => Array.isArray(m.content) && m.content.some(p => p.type === 'input_image'))) console.log(JSON.stringify({ request: id, image: true }));
  const words = typeof latest?.content === 'string' ? latest.content : '';
  let text = 'The preview is working. These are local test responses.';
  let output;
  const calledName = toolOutput && (input.find(m => m.type === 'function_call' && m.call_id === toolOutput.call_id)?.name ?? calls.get(toolOutput.call_id));
  if (toolOutput && calledName === 'use_app') text = 'The post is drafted. It goes out once you allow it.';
  else if (toolOutput) text = 'Penny confirmed that the invoice is ready. I’ll use that result for the next step.';
  else if (body.instructions?.includes('You are answering')) text = 'The invoice is ready for review. The total and vendor match the purchase order.';
  else if (/ask penny/i.test(words)) output = [{ type: 'function_call', id: id + '-call', call_id: id + '-call', name: 'ask_teammate', arguments: JSON.stringify({ bot_id: 'penny', question: 'Is the invoice ready for review?' }), status: 'completed' }];
  else if (/post (it )?to linkedin/i.test(words)) output = [{ type: 'function_call', id: id + '-call', call_id: id + '-call', name: 'use_app', arguments: JSON.stringify({ action: 'LINKEDIN_CREATE_LINKED_IN_POST', arguments: { commentary: 'We just shipped live streaming in Bops.', visibility: 'PUBLIC' }, account: null }), status: 'completed' }];
  else if (/@penny/i.test(words)) text = 'The invoice is ready for review. I checked the total and vendor against the purchase order.';
  else if (/summary|status/i.test(words)) text = 'Penny has the invoice ready. I can coordinate the next step once you give the instruction.';
  else if (/\btable\b/i.test(words)) text = 'Here is the pipeline:\n\n| Lead | Stage | Value |\n|---|---|---|\n| Acme | Demo | 12000 |\n| Globex | Proposal | 8000 |\n\nTwo deals are moving.';
  for (const o of output ?? []) if (o.type === 'function_call') calls.set(o.call_id, o.name);
  output ??= [{ type: 'message', id: id + '-message', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text, annotations: [] }] }];
  if (/long answer|stream test/i.test(words) && output[0].type === 'message') {
    text = 'Here is a longer answer, written a few words at a time so the stream can be watched. ' + 'Each piece arrives on its own, with a short pause between pieces. '.repeat(4) + 'That is the end.';
    output[0].content[0].text = text;
  }
  const response = { id, object: 'response', created_at: Math.floor(Date.now() / 1000), status: 'completed', model: body.model, output, output_text: output[0].type === 'message' ? text : '', reasoning: body.reasoning, usage: { input_tokens: 10, output_tokens: 10, total_tokens: 20 } };
  if (body.stream) return streamResponse(res, response, output[0].type === 'message' ? text : '');
  res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(response));
});

/**
 * The same response as Responses API server-sent events, the text a few words per chunk with
 * FIXTURE_CHUNK_MS between chunks (default 120), and the first after FIXTURE_FIRST_MS (default 400).
 * Each chunk's send time is logged (FIXTURE_LOG=1), to measure chunk-to-screen time.
 */
async function streamResponse(res, response, text) {
  const wait = ms => new Promise(r => setTimeout(r, ms));
  let n = 0;
  const send = (type, fields) => res.write(`event: ${type}\ndata: ${JSON.stringify({ type, sequence_number: n++, ...fields })}\n\n`);
  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' });
  send('response.created', { response: { ...response, status: 'in_progress', output: [] } });
  for (const [index, item] of response.output.entries()) {
    if (item.type !== 'message') {
      send('response.output_item.added', { output_index: index, item: { ...item, arguments: '' } });
      send('response.function_call_arguments.delta', { output_index: index, item_id: item.id, delta: item.arguments });
      send('response.output_item.done', { output_index: index, item });
      continue;
    }
    send('response.output_item.added', { output_index: index, item: { ...item, status: 'in_progress', content: [] } });
    send('response.content_part.added', { output_index: index, item_id: item.id, content_index: 0, part: { type: 'output_text', text: '', annotations: [] } });
    await wait(Number(process.env.FIXTURE_FIRST_MS || 400));
    const pieces = text.match(/\S+\s*/g) || [];
    for (let i = 0; i < pieces.length; i += 3) {
      const delta = pieces.slice(i, i + 3).join('');
      send('response.output_text.delta', { output_index: index, item_id: item.id, content_index: 0, delta, logprobs: [] });
      if (process.env.FIXTURE_LOG) console.log(JSON.stringify({ chunk: response.id, i, at: Date.now(), delta }));
      await wait(Number(process.env.FIXTURE_CHUNK_MS || 120));
    }
    send('response.output_text.done', { output_index: index, item_id: item.id, content_index: 0, text, logprobs: [] });
    send('response.output_item.done', { output_index: index, item });
  }
  send('response.completed', { response: { ...response, output_text: undefined } });
  res.end();
}
server.listen(Number(process.env.FIXTURE_MODEL_PORT || 3221), '127.0.0.1', () => console.log('Local fixture model ready'));
