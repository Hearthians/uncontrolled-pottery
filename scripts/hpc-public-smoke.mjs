// Synthetic smoke test run within the allocated service node; no credentials in output.
const base = `http://127.0.0.1:${process.env.POTTERY_SMOKE_PORT || '5187'}/pottery/api/memories/jobs`;
const response = await fetch(base, { method: 'POST', headers: { origin: 'https://gfyh.fun', 'content-type': 'application/json' }, body: JSON.stringify({ input: { kind: 'text', text: 'I felt calm in the garden.' } }) });
if (response.status !== 202) throw new Error(`Create failed: ${response.status}`);
const { id, token } = await response.json();
let result;
for (let i = 0; i < 120; i++) {
  await new Promise(resolve => setTimeout(resolve, 500));
  const poll = await fetch(`${base}/${id}`, { headers: { origin: 'https://gfyh.fun', 'x-memory-job-token': token } });
  if (!poll.ok) throw new Error(`Poll failed: ${poll.status}`);
  result = await poll.json();
  if (['completed', 'failed', 'cancelled'].includes(result.status)) break;
}
if (result?.status !== 'completed' || !result.entries?.length) throw new Error(`Job failed: ${result?.status ?? 'timeout'}`);
console.log(`Synthetic analysis completed: ${result.entries.length} entries`);
await fetch(`${base}/${id}`, { method: 'DELETE', headers: { origin: 'https://gfyh.fun', 'x-memory-job-token': token } });
