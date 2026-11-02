import test from "node:test";
import assert from "node:assert/strict";
import {
  MAX_MEMORIES,
  MAX_MEMORY_FILE_BYTES,
  MAX_MEMORY_TEXT_LENGTH,
  MAX_TOTAL_MEMORY_TEXT_LENGTH,
  MemoryImportError,
  memoryIndexAtStep,
  memoryPassageAtStep,
  parseMemories,
} from "../src/memoryPlayback.ts";

const parse = (value) => parseMemories(JSON.stringify(value));

test("imports activity, content, and string formats as text only, preserving file order", () => {
  assert.deepEqual(parse([
    { activity: " Test memory 1 ", name: "Test person", date: "2099-01-01", other: { secret: true } },
    { content: "Test memory 2", date: "2000-01-01" },
    "Test memory 3",
    { activity: "Test memory 4", content: "Ignored alternate" },
  ]), [1, 2, 3, 4].map((i) => ({ text: `Test memory ${i}` })));
  assert.deepEqual(parseMemories('﻿["Test memory 1"]'), [{ text: "Test memory 1" }]);
});

test("retains Unicode and treats HTML-like text as ordinary text", () => {
  const text = "Test memory — 测试\n<script>not executable</script>";
  assert.deepEqual(parse([text]), [{ text }]);
});

test("accepts a single entry and the complete 2,000-entry capacity", () => {
  assert.equal(parse(["Test memory 1"]).length, 1);
  assert.equal(parse(Array(MAX_MEMORIES).fill("Test memory")).length, MAX_MEMORIES);
  assert.throws(() => parse(Array(MAX_MEMORIES + 1).fill("Test memory")), MemoryImportError);
});

test("rejects malformed JSON and bad shapes without exposing submitted text", () => {
  assert.throws(() => parseMemories('{"PRIVATE_TEST_SENTINEL":'), (error) =>
    error instanceof MemoryImportError && !error.message.includes("PRIVATE_TEST_SENTINEL"));
  for (const invalid of [null, {}, "Test memory", 12, [], [null], [false], [2], [[]], [{}], [""], [" \n\t"], [{ activity: 1 }], [{ content: null }], [{ name: "Only a name" }]]) {
    assert.throws(() => parse(invalid), MemoryImportError, JSON.stringify(invalid));
  }
  assert.throws(() => parse(["Test memory 1", { activity: " " }, "Test memory 3"]), /Memory 2/);
});

test("file byte limit includes UTF-8 multibyte text and JSON metadata", () => {
  const accepted = JSON.stringify(["Test memory"]);
  assert.equal(parseMemories(accepted + " ".repeat(MAX_MEMORY_FILE_BYTES - accepted.length)).length, 1);
  assert.throws(() => parseMemories(" ".repeat(MAX_MEMORY_FILE_BYTES + 1)), /8 MiB/);
  const largeMetadata = JSON.stringify([{ content: "Test memory", unused: "汉".repeat(Math.ceil(MAX_MEMORY_FILE_BYTES / 3)) }]);
  assert.ok(largeMetadata.length < MAX_MEMORY_FILE_BYTES);
  assert.throws(() => parseMemories(largeMetadata), /8 MiB/);
});

test("enforces per-entry and total text limits atomically", () => {
  const text = "x".repeat(MAX_MEMORY_TEXT_LENGTH);
  assert.equal(parse([text])[0].text.length, MAX_MEMORY_TEXT_LENGTH);
  assert.throws(() => parse([text + "x"]), /10,000 characters/);
  const count = MAX_TOTAL_MEMORY_TEXT_LENGTH / MAX_MEMORY_TEXT_LENGTH;
  assert.equal(parse(Array(count).fill(text)).length, count);
  assert.throws(() => parse([...Array(count).fill(text), "x"]), /total limit/);
  const existing = parse(["Test existing memory"]);
  let state = existing;
  try { state = parse(["Test replacement", 42]); } catch {}
  assert.equal(state, existing, "no partially accepted replacement");
});

test("playback maps the original full-plan deposited steps, including exact boundaries", () => {
  assert.equal(memoryIndexAtStep(0, 0, 100), -1);
  assert.equal(memoryIndexAtStep(0, 10, 100), 0);
  assert.equal(memoryIndexAtStep(-20, 10, 100), 0);
  assert.equal(memoryIndexAtStep(9, 10, 100), 0);
  assert.equal(memoryIndexAtStep(10, 10, 100), 1);
  assert.equal(memoryIndexAtStep(49.9, 10, 100), 4);
  assert.equal(memoryIndexAtStep(50, 10, 100), 5);
  assert.equal(memoryIndexAtStep(99, 10, 100), 9);
  assert.equal(memoryIndexAtStep(100, 10, 100), 9);
  assert.equal(memoryIndexAtStep(1000, 10, 100), 9);
  assert.equal(memoryIndexAtStep(100, 1, 100), 0);
  assert.equal(memoryIndexAtStep(NaN, 10, 100), 0);
  assert.equal(memoryIndexAtStep(Infinity, 10, 100), 0);
  assert.equal(memoryIndexAtStep(50, 10, 0), 0);
  assert.equal(memoryIndexAtStep(50, NaN, 100), -1);
});

test("pause and settling keep the index, an early finish does not jump, and a new run resets", () => {
  const stoppedAt = 2400;
  const fullPlan = 12288;
  const atStop = memoryIndexAtStep(stoppedAt, 1910, fullPlan);
  assert.ok(atStop > 0 && atStop < 1910 / 4);
  for (let elapsed = 0; elapsed < 100; elapsed++) {
    assert.equal(memoryIndexAtStep(stoppedAt, 1910, fullPlan), atStop);
  }
  assert.equal(memoryIndexAtStep(0, 1910, fullPlan), 0);
  assert.equal(memoryIndexAtStep(fullPlan, 1910, fullPlan), 1909);
});

test("large collections dwell on selected passages without speeding up on pause or early finish", () => {
  assert.equal(memoryPassageAtStep(0, 2000, 1400), 0);
  assert.equal(memoryPassageAtStep(99, 2000, 1400), 0);
  assert.equal(memoryPassageAtStep(100, 2000, 1400), 142);
  assert.equal(memoryPassageAtStep(199, 2000, 1400), 142);
  assert.equal(memoryPassageAtStep(1400, 2000, 1400), 1999);
  assert.ok(memoryPassageAtStep(300, 2000, 1400) < 1000);
  assert.equal(memoryPassageAtStep(NaN, 2000, 1400), 0);
  assert.equal(memoryPassageAtStep(4, 2000, 0), 0);
  for (let step = 0; step <= 100; step++)
    assert.equal(memoryPassageAtStep(step, 10, 100), memoryIndexAtStep(step, 10, 100));
});

test("sampled passages refer to complete original entries, including duplicate text", () => {
  const originals = Array.from({ length: MAX_MEMORIES }, (_, index) => `Original ${index}\nAn unchanged second line.`);
  originals[1] = originals[0];
  const memories = parse(originals);
  for (let step = 0; step <= 1400; step++) {
    const index = memoryPassageAtStep(step, memories.length, 1400);
    assert.equal(memories[index].text, originals[index]);
  }
  assert.equal(memories.length, MAX_MEMORIES, "identical memories remain separate entries");
});
