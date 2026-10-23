import test from "node:test";
import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";

test("download progress metadata matches the vendored model and runtime sizes", async () => {
  const base = new URL("../public/hand-tracking/", import.meta.url);
  const sizes = JSON.parse(await readFile(new URL("assets.json", base), "utf8"));
  assert.equal(Object.keys(sizes).length, 5);
  for (const [path, bytes] of Object.entries(sizes)) {
    assert.equal((await stat(new URL(path, base))).size, bytes, path);
  }
});
