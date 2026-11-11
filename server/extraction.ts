import { parse } from 'csv-parse/sync';
import type { MemoryInput } from '../shared/memoryAnalysis.ts';

export const MAX_FILE_BYTES = 8 * 1024 * 1024;
export const MAX_TEXT_UNITS = 2_000_000;
const MAX_ZIP_BYTES = 32 * 1024 * 1024;
const MAX_ZIP_ENTRY = 16 * 1024 * 1024;
const MAX_ZIP_ENTRIES = 1000;
const MAX_PDF_PAGES = 100;

function checkedText(text: string): string {
  if (text.length > MAX_TEXT_UNITS) throw new Error('Extracted text is too large');
  if (!/\S/u.test(text)) throw new Error('No extractable text');
  return text;
}
function decode(buffer: Buffer): string { try { return new TextDecoder('utf-8', { fatal: true }).decode(buffer); } catch { throw new Error('File must contain valid UTF-8'); } }
function jsonText(text: string): string {
  try { JSON.parse(text); } catch { throw new Error('Invalid JSON'); }
  // Tokenize the validated input instead of traversing JSON.parse's object:
  // integer-like keys are reordered and duplicate keys overwritten by JS objects.
  const tokens = /"(?:\\.|[^"\\])*"|[{}\[\],:]|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?|true|false|null/gy;
  const stack: { object: boolean; key: boolean }[] = [], strings: string[] = [];
  let position = 0, length = 0;
  while (position < text.length) {
    while (position < text.length && /\s/.test(text[position])) position++;
    if (position === text.length) break;
    tokens.lastIndex = position;
    const match = tokens.exec(text);
    if (!match) throw new Error('Invalid JSON');
    const token = match[0], parent = stack.at(-1);
    position = tokens.lastIndex;
    if (token === '{') stack.push({ object: true, key: true });
    else if (token === '[') stack.push({ object: false, key: false });
    else if (token === '}' || token === ']') stack.pop();
    else if (token === ',' && parent?.object) parent.key = true;
    else if (token.startsWith('"')) {
      if (parent?.object && parent.key) parent.key = false;
      else {
        const value: string = JSON.parse(token);
        length += value.length + (strings.length ? 2 : 0);
        if (length > MAX_TEXT_UNITS) throw new Error('Extracted text is too large');
        strings.push(value);
      }
    }
  }
  return strings.join('\n\n');
}
async function checkZip(data: Buffer): Promise<void> {
  const yauzl = await import('yauzl');
  await new Promise<void>((resolve, reject) => {
    yauzl.fromBuffer(data, { lazyEntries: true, validateEntrySizes: true, strictFileNames: true }, (err, zip) => {
      if (err || !zip) return reject(new Error('Invalid DOCX archive'));
      let count = 0, total = 0, done = false;
      const fail = () => { if (!done) { done = true; zip.close(); reject(new Error('Unsafe DOCX archive')); } };
      zip.on('error', fail);
      zip.on('end', () => { if (!done) { done = true; resolve(); } });
      zip.on('entry', entry => {
        count++; total += entry.uncompressedSize;
        const name = entry.fileName;
        if (count > MAX_ZIP_ENTRIES || total > MAX_ZIP_BYTES || entry.uncompressedSize > MAX_ZIP_ENTRY || (entry.generalPurposeBitFlag & 1) || name.includes('\\') || name.startsWith('/') || /^[A-Za-z]:/.test(name) || name.split('/').some(x => x === '..' || x === '.')) return fail();
        zip.openReadStream(entry, (error, stream) => {
          if (error || !stream) return fail();
          let actual = 0;
          stream.on('data', (chunk: Buffer) => { actual += chunk.length; if (actual > entry.uncompressedSize || actual > MAX_ZIP_ENTRY) { stream.destroy(); fail(); } });
          stream.on('error', fail);
          stream.on('end', () => { if (!done) zip.readEntry(); });
        });
      });
      zip.readEntry();
    });
  });
}
async function pdfText(data: Buffer): Promise<string> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  // PDF.js 6 no longer exposes or uses isEvalSupported; the extra flag also
  // disables generated code on older versions if they are ever substituted.
  const task = pdfjs.getDocument({ data: new Uint8Array(data), useSystemFonts: false, disableFontFace: true, useWorkerFetch: false, stopAtErrors: true, verbosity: 0, isEvalSupported: false } as Parameters<typeof pdfjs.getDocument>[0]);
  try {
    const pdf = await task.promise;
    if (pdf.numPages > MAX_PDF_PAGES || await pdf.getPermissions() !== null) throw new Error('Unsupported PDF');
    let result = '';
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const content = await page.getTextContent();
      const part = content.items.map(item => 'str' in item ? item.str + (item.hasEOL ? '\n' : ' ') : '').join('');
      result += (i === 1 ? '' : '\n\n') + part;
      if (result.length > MAX_TEXT_UNITS) throw new Error('Extracted text is too large');
      page.cleanup();
    }
    return result;
  } catch { throw new Error('PDF cannot be extracted (encrypted, invalid, or too large)'); }
  finally { await task.destroy(); }
}
export async function extractInput(input: MemoryInput): Promise<string> {
  if (input.kind === 'text') return checkedText(input.text);
  if (!input.name || input.name.length > 255 || /[\\/\0]/.test(input.name) || input.name === '.' || input.name === '..') throw new Error('Invalid filename');
  const encoded = input.dataBase64;
  if (encoded.length > Math.ceil(MAX_FILE_BYTES / 3) * 4 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encoded)) throw new Error('Invalid or oversized file');
  const data = Buffer.from(encoded, 'base64');
  if (data.length > MAX_FILE_BYTES || data.toString('base64') !== encoded) throw new Error('Invalid or oversized file');
  const ext = input.name.toLowerCase().split('.').pop();
  let text: string;
  if (ext === 'txt' || ext === 'md') text = decode(data);
  else if (ext === 'json') text = jsonText(decode(data));
  else if (ext === 'csv') {
    try { const rows = parse(decode(data), { bom: true, relax_column_count: true, skip_empty_lines: false }) as string[][]; text = rows.flat().join('\n\n'); }
    catch { throw new Error('Invalid CSV'); }
  } else if (ext === 'docx') {
    await checkZip(data);
    const mammoth = await import('mammoth');
    try { text = (await mammoth.extractRawText({ buffer: data })).value; } catch { throw new Error('Invalid DOCX'); }
  } else if (ext === 'pdf') text = await pdfText(data);
  else throw new Error('Unsupported file type');
  return checkedText(text);
}
