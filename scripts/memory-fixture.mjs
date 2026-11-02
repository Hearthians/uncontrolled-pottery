// Deterministic fictional originals for screenshot and interaction regression tests.
export const MEMORY_FIXTURE = [
  "The light stayed on\nlong after everyone had left.",
  "We took the longer way home.\nNeither of us asked why.",
  "Rain on the windows.\nAn unfinished conversation.",
  "For a moment,\nthere was nowhere else to be.",
];
export async function mockDefaultMemories(context, entries = MEMORY_FIXTURE) {
  await context.route('**/memories.json', (route) => route.fulfill({
    status: 200, contentType: 'application/json', headers: { 'Cache-Control': 'no-store' },
    body: JSON.stringify(entries),
  }));
}
