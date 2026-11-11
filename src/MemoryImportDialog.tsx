import { useEffect, useRef, useState } from "react";
import type { ScoredMemoryEntry } from "../shared/memoryAnalysis.ts";
import { MAX_MEMORY_FILE_BYTES } from "./memoryPlayback";
import { cancelAnalysis, createAnalysis, fileInput, getAnalysis } from "./memoryAnalysisClient";
import type { MemorySource } from "./memorySource";
import "./memoryImportDialog.css";

type Handle = Awaited<ReturnType<typeof createAnalysis>>;
type Phase = "input" | "preparing" | "queued" | "extracting" | "analyzing" | "review" | "error";

export function MemoryImportDialog({ source, locked, anonymousPublic, onApplied, onClose }: { source: MemorySource; locked: boolean; anonymousPublic: boolean; onApplied: () => void; onClose: () => void }) {
  const [text, setText] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [accessCode, setAccessCode] = useState("");
  const [consent, setConsent] = useState(false);
  const [phase, setPhase] = useState<Phase>("input");
  const [progress, setProgress] = useState({ completed: 0, total: 0 });
  const [entries, setEntries] = useState<ScoredMemoryEntry[]>([]);
  const [error, setError] = useState("");
  const dialogRef = useRef<HTMLDialogElement>(null);
  const generation = useRef(0);
  const sourceGeneration = useRef<number | null>(null);
  const job = useRef<Handle | null>(null);
  const controller = useRef<AbortController | null>(null);
  const busy = ["preparing", "queued", "extracting", "analyzing"].includes(phase);

  function abandon() {
    generation.current++;
    if (sourceGeneration.current !== null) source.endAnalysis(sourceGeneration.current);
    sourceGeneration.current = null;
    controller.current?.abort(); controller.current = null;
    const pending = job.current; job.current = null;
    if (pending) void cancelAnalysis(pending).catch(() => {});
  }
  useEffect(() => {
    const dialog = dialogRef.current;
    dialog?.showModal();
    return () => { abandon(); dialog?.close(); };
  }, []);
  useEffect(() => { if (locked) { abandon(); onClose(); } }, [locked]);

  async function start() {
    if (locked || !consent || busy || (!file && !text.trim())) return;
    if (file && file.size > MAX_MEMORY_FILE_BYTES) { setError("Files must be 8 MiB or smaller."); setPhase("error"); return; }
    if (!file && new TextEncoder().encode(text).byteLength > MAX_MEMORY_FILE_BYTES) { setError("Text must be 8 MiB or smaller."); setPhase("error"); return; }
    const sourceToken = source.beginAnalysis();
    if (sourceToken === null) return;
    sourceGeneration.current = sourceToken;
    const run = ++generation.current;
    setEntries([]); setError(""); setProgress({ completed: 0, total: 0 }); setPhase("preparing");
    try {
      const input = file ? await fileInput(file) : { kind: "text" as const, text };
      if (run !== generation.current) return;
      // Do not abort an in-flight creation: if the dialog closes while POST is
      // pending, delete the returned job immediately when its handle arrives.
      const handle = await createAnalysis(input, accessCode);
      if (run !== generation.current) { void cancelAnalysis(handle).catch(() => {}); return; }
      job.current = handle;
      const abort = new AbortController(); controller.current = abort;
      for (;;) {
        const result = await getAnalysis(handle, abort.signal);
        if (run !== generation.current) return;
        setProgress(result.progress);
        if (result.status === "completed") { setEntries(result.entries!); setPhase("review"); return; }
        if (result.status === "failed" || result.status === "cancelled") throw new Error(result.status === "cancelled" ? "Analysis was cancelled." : result.error || "Analysis failed. Check your input and try again.");
        setPhase(result.status);
        await new Promise<void>((resolve, reject) => {
          const timer = window.setTimeout(() => { abort.signal.removeEventListener("abort", cancelled); resolve(); }, 1000);
          const cancelled = () => { clearTimeout(timer); reject(new DOMException("Aborted", "AbortError")); };
          abort.signal.addEventListener("abort", cancelled, { once: true });
        });
      }
    } catch (reason) {
      if (run !== generation.current) return;
      if (sourceGeneration.current !== null) source.endAnalysis(sourceGeneration.current);
      sourceGeneration.current = null;
      controller.current?.abort(); controller.current = null;
      const failedJob = job.current; job.current = null;
      if (failedJob) void cancelAnalysis(failedJob).catch(() => {});
      const message = reason instanceof Error ? reason.message : "Analysis failed.";
      setError(message === "Analysis is busy or its job limit was reached. Try later."
        ? "Analysis is busy, the job limit or a service quota may have been reached. Try again later."
        : anonymousPublic && (message === "Analysis failed" || message === "Model transient error") ? "Analysis failed. The model service may be unavailable or its quota may have been reached; try again later." : message);
      setPhase("error");
    }
  }
  function apply() {
    if (locked || sourceGeneration.current === null) return;
    try {
      if (!source.applyAnalysis(sourceGeneration.current, entries)) { setError("The active collection changed. Analyze again before applying."); setPhase("error"); return; }
      onApplied();
      onClose();
    } catch { setError("The result was invalid; the active collection was not changed."); setPhase("error"); }
  }
  return <dialog ref={dialogRef} className="memory-import-dialog" aria-labelledby="memory-import-title" onCancel={event => { event.preventDefault(); onClose(); }}>
    <div className="memory-import-content">
      <div className="memory-import-heading"><h2 id="memory-import-title">Analyze memories</h2><button type="button" aria-label="Close memory import" onClick={onClose}>×</button></div>
      <p>Paste text or choose TXT, Markdown, JSON, CSV, DOCX or text-based PDF. Maximum 8 MiB. Scanned PDFs are not supported.</p>
      <p>When you choose Analyze, your text is sent to this service and {anonymousPublic ? "the model gateway (MiniMax; GPT-6 Luna may be used as fallback)" : "its model gateway"}. Providers may retain it. Only submit text you have permission to share.</p>
      {anonymousPublic && <p>Model gateway limits apply.</p>}
      <details><summary>Privacy</summary><p>Memory text and individual scores are not saved with the pottery; saved process settings may indirectly reveal information about scores.</p></details>
      {phase !== "review" && <>
        <label htmlFor="memory-import-text">Paste text</label>
        <textarea id="memory-import-text" value={text} disabled={busy || !!file} onChange={event => setText(event.target.value)} rows={5} />
        <label htmlFor="memory-import-file">Or choose a file</label>
        <input id="memory-import-file" type="file" accept=".txt,.md,.json,.csv,.docx,.pdf" disabled={busy} onChange={event => { setFile(event.target.files?.[0] ?? null); }} />
        {file && <p>Selected: {file.name} ({Math.ceil(file.size / 1024)} KiB). <button type="button" disabled={busy} onClick={() => setFile(null)}>Remove file</button></p>}
        {!anonymousPublic && <><label htmlFor="memory-access-code">Analysis access code (if required)</label>
        <input id="memory-access-code" type="password" autoComplete="off" value={accessCode} disabled={busy} onChange={event => setAccessCode(event.target.value)} /></>}
        <label className="memory-consent"><input type="checkbox" checked={consent} disabled={busy} onChange={event => setConsent(event.target.checked)} /> I agree to send this content to the analysis service and configured model gateway{anonymousPublic ? " for MiniMax and possible GPT-6 Luna analysis" : ""}.</label>
        <button type="button" className="memory-import-primary" disabled={locked || busy || !consent || (!file && !text.trim())} onClick={() => void start()}>Analyze memories</button>
      </>}
      {busy && <p role="status">{phase === "preparing" ? "Preparing" : phase === "queued" ? "Queued" : phase === "extracting" ? "Extracting" : "Splitting and scoring"}… {progress.total > 0 && `${progress.completed} / ${progress.total}`}</p>}
      {busy && <button type="button" onClick={() => { abandon(); setPhase("input"); }}>Cancel analysis</button>}
      {error && <p role="alert">{error}</p>}
      {phase === "review" && <div className="memory-review"><h3>Review {entries.length} {entries.length === 1 ? "memory" : "memories"}</h3><p>These scores are an artistic interpretation, not a diagnosis. Review the extracted passages before replacing the active collection.</p><ol>{entries.map(entry => <li key={entry.id}><p>{entry.text}</p><small>Calm {entry.scores.calm} · Anxiety {entry.scores.anxiety} · Anger {entry.scores.anger} · Stress {entry.scores.stress} · Sadness {entry.scores.sadness}</small></li>)}</ol><button type="button" className="memory-import-primary" disabled={locked} onClick={apply}>Use these memories</button></div>}
    </div>
  </dialog>;
}
