import type { JobResponse, MemoryInput } from "../shared/memoryAnalysis.ts";
import { validateAnalyzedMemories } from "./memoryPlayback";

const jobsUrl = `${import.meta.env.BASE_URL}api/memories/jobs`;
type JobHandle = { id: string; token: string; accessCode: string };
function headers(accessCode: string, token?: string): HeadersInit {
  return { "Content-Type": "application/json", ...(accessCode ? { "X-Memory-Access-Code": accessCode } : {}), ...(token ? { "X-Memory-Job-Token": token } : {}) };
}
function message(status: number) {
  if (status === 403) return "Analysis access denied. Check the access code or service configuration.";
  if (status === 429) return "Analysis is busy or its job limit was reached. Try later.";
  if (status === 503) return "Analysis is not configured on this service.";
  return "The analysis service could not complete the request.";
}
export async function createAnalysis(input: MemoryInput, accessCode: string): Promise<JobHandle> {
  const response = await fetch(jobsUrl, { method: "POST", headers: headers(accessCode), body: JSON.stringify({ input }), cache: "no-store" });
  if (!response.ok) throw new Error(message(response.status));
  const value: unknown = await response.json();
  if (!value || typeof value !== "object" || !("id" in value) || !("token" in value) || typeof value.id !== "string" || !/^[\w-]+$/.test(value.id) || typeof value.token !== "string" || !value.token) throw new Error("Invalid analysis service response.");
  return { id: value.id, token: value.token, accessCode };
}
export async function cancelAnalysis(job: JobHandle): Promise<void> {
  await fetch(`${jobsUrl}/${encodeURIComponent(job.id)}`, { method: "DELETE", headers: headers(job.accessCode, job.token), cache: "no-store", keepalive: true });
}
export async function getAnalysis(job: JobHandle, signal: AbortSignal): Promise<JobResponse> {
  const response = await fetch(`${jobsUrl}/${encodeURIComponent(job.id)}`, { headers: headers(job.accessCode, job.token), signal, cache: "no-store" });
  if (!response.ok) throw new Error(message(response.status));
  const data: unknown = await response.json();
  if (!data || typeof data !== "object" || !("id" in data) || data.id !== job.id || !("status" in data) || !["queued", "extracting", "analyzing", "completed", "failed", "cancelled"].includes(String(data.status)) || !("progress" in data) || !data.progress || typeof data.progress !== "object" || !("completed" in data.progress) || !("total" in data.progress) || !Number.isSafeInteger(data.progress.completed) || !Number.isSafeInteger(data.progress.total) || Number(data.progress.completed) < 0 || Number(data.progress.total) < Number(data.progress.completed)) throw new Error("Invalid analysis service response.");
  if (data.status === "completed") validateAnalyzedMemories("entries" in data ? data.entries : undefined);
  return data as JobResponse;
}
export async function fileInput(file: File): Promise<MemoryInput> {
  const buffer = new Uint8Array(await file.arrayBuffer());
  let binary = "";
  for (let i = 0; i < buffer.length; i += 0x8000) binary += String.fromCharCode(...buffer.subarray(i, i + 0x8000));
  return { kind: "file", name: file.name, dataBase64: btoa(binary) };
}
