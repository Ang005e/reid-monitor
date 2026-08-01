import fs from 'node:fs';
import path from 'node:path';

/**
 * Append-only file helpers.
 *
 * Both live CSVs are history: once a line is written it is never rewritten or
 * truncated by the app. Everything here is append-or-read; there is deliberately
 * no update or rewrite primitive. `resetFile` exists only for the explicit
 * SIM_RESET / --reset path and says so loudly at the call site.
 */

export function ensureDir(dir: string): void {
  fs.mkdirSync(dir, { recursive: true });
}

export function exists(file: string): boolean {
  return fs.existsSync(file);
}

/**
 * Creates the file with a header line if it is absent or empty.
 * Returns true when the header was written (i.e. this is a cold start).
 */
export function ensureHeader(file: string, header: string): boolean {
  ensureDir(path.dirname(file));
  if (fs.existsSync(file) && fs.statSync(file).size > 0) return false;
  fs.writeFileSync(file, `${header}\n`, 'utf8');
  return true;
}

/**
 * Appends lines. Uses a single synchronous write so a line can never be
 * interleaved or half-written if the process dies mid-tick.
 */
export function appendLines(file: string, lines: readonly string[]): void {
  if (lines.length === 0) return;
  ensureDir(path.dirname(file));
  fs.appendFileSync(file, `${lines.join('\n')}\n`, 'utf8');
}

export function readText(file: string): string {
  return fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
}

/** Number of data lines (excludes the header and any trailing newline). */
export function countDataLines(file: string): number {
  const text = readText(file);
  if (text.trim() === '') return 0;
  return Math.max(0, text.trim().split(/\r?\n/).length - 1);
}

/**
 * DESTRUCTIVE. Deletes a live history file so it can be rebuilt from source.
 * Only ever called behind an explicit reset flag — never as part of normal
 * operation, which is strictly append-only.
 */
export function resetFile(file: string): void {
  if (fs.existsSync(file)) fs.rmSync(file);
}
