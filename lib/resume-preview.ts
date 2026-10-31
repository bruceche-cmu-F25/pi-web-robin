import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { MAX_RESUME_BYTES, MAX_RESUME_PDF_PAGES, ResumeError, resumeText } from "../extension/robin/resume";

const MAX_PDF = 8 * 1024 * 1024;
const MAX_IMAGES = 10 * 1024 * 1024;
export const resumeTexCache = () => path.join(os.homedir(), "Library", "Caches", "pi-web-resume", "tectonic");
const state = globalThis as typeof globalThis & { __resumePreviewBusy?: boolean };

/** macOS Seatbelt is the boundary, not a TeX command deny-list or --untrusted alone. */
export function resumePreviewSandbox(directory: string, cache: string, binaries: string[]) {
  const quote = (value: string) => JSON.stringify(value);
  return `(version 1)
(deny default)
(allow sysctl-read)
(allow file-read-metadata)
(allow process-exec ${["/bin/bash", ...binaries].map(p => `(literal ${quote(p)})`).join(" ")})
(allow file-read* ${[directory, cache, "/System/Library", "/usr/lib", "/usr/share/locale", "/Library/Fonts", "/opt/homebrew/Cellar", "/opt/homebrew/opt", "/usr/local/Cellar", "/usr/local/opt"].map(p => `(subpath ${quote(p)})`).join(" ")}
 (literal "/") (literal "/bin/bash") (literal "/dev/null") (literal "/dev/urandom") (literal "/dev/random") (literal "/private/etc/localtime"))
(allow file-write* (subpath ${quote(directory)}) (literal "/dev/null"))
`; // No network, other executable, user-home read, or shared-cache write permission.
}

async function executable(name: string) {
  for (const prefix of ["/opt/homebrew/bin", "/usr/local/bin"]) {
    try { const file = await fs.realpath(path.join(prefix, name)); await fs.access(file, fs.constants.X_OK); return file; } catch { /* Try the other Homebrew prefix. */ }
  }
  throw new ResumeError(`Preview needs ${name}. See docs/agents/resume.md for local preview setup.`, 503);
}

/** Wait for close, even after abort/overflow, before cleanup or releasing the single compiler slot. */
export function runResumePreviewTool(binary: string, args: string[], directory: string, cache: string, profile: string, signal?: AbortSignal, timeout = 20_000): Promise<string> {
  if (signal?.aborted) return Promise.reject(new ResumeError("Preview cancelled", 499));
  return new Promise((resolve, reject) => {
    const child = spawn("/usr/bin/sandbox-exec", ["-p", profile, "/bin/bash", "--noprofile", "--norc", "-c",
      'ulimit -t 15 && ulimit -f 16384 && ulimit -n 128 && exec "$@"', "resume-preview", binary, ...args], {
      cwd: directory, stdio: ["ignore", "pipe", "pipe"],
      env: { NODE_ENV: "production", PATH: "/usr/bin:/bin", HOME: directory, TMPDIR: directory, TECTONIC_CACHE_DIR: cache, LANG: "en_US.UTF-8", LC_ALL: "C", TECTONIC_UNTRUSTED_MODE: "1" },
    });
    let output = "", bytes = 0, failure: Error | undefined;
    const stop = (error: Error) => { failure ??= error; child.kill("SIGKILL"); };
    const abort = () => stop(new ResumeError("Preview cancelled", 499));
    const timer = setTimeout(() => stop(new ResumeError("Preview exceeded its time limit. Simplify the document and retry.", 422)), timeout);
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) abort();
    const collect = (chunk: Buffer) => {
      bytes += chunk.length;
      if (bytes > 128 * 1024) stop(new ResumeError("Compiler output exceeded the preview limit.", 422));
      else output += chunk.toString("utf8");
    };
    child.stdout.on("data", collect); child.stderr.on("data", collect);
    child.on("error", error => { failure ??= error; });
    child.on("close", (code, exitSignal) => {
      clearTimeout(timer); signal?.removeEventListener("abort", abort);
      if (failure) reject(failure);
      else if (code !== 0) reject(new ResumeError(cleanLog(output, directory, cache) || `The isolated compiler could not run (${exitSignal ?? code}).`, 422));
      else resolve(output);
    });
  });
}
function cleanLog(log: string, directory: string, cache: string) {
  return log.replaceAll(directory, "[preview]").replaceAll(cache, "[tex-cache]")
    .replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, "").slice(-12_000).trim();
}

export async function compileResumePreview(value: unknown, signal?: AbortSignal) {
  const source = resumeText(value, "source", MAX_RESUME_BYTES);
  if (!source.trim()) throw new ResumeError("Add LaTeX source before previewing.");
  if (signal?.aborted) throw new ResumeError("Preview cancelled", 499);
  if (os.platform() !== "darwin") throw new ResumeError("Local preview currently requires macOS sandbox-exec; unsafe compilation is never used as a fallback.", 503);
  // ponytail: one bounded local compiler, no queue; a busy second tab can retry.
  if (state.__resumePreviewBusy) throw new ResumeError("Another resume preview is compiling. Retry shortly.", 429);
  state.__resumePreviewBusy = true;
  let directory: string | undefined;
  try {
    const [tectonic, pdfinfo, pdftoppm] = await Promise.all(["tectonic", "pdfinfo", "pdftoppm"].map(executable));
    let cache: string;
    try { cache = await fs.realpath(resumeTexCache()); await fs.access(path.join(cache, "formats")); }
    catch { throw new ResumeError("Preview's offline TeX packages are not ready. Run node --experimental-strip-types scripts/prepare-resume-preview.mjs first.", 503); }
    directory = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "robin-resume-preview-")));
    await fs.writeFile(path.join(directory, "resume.tex"), source, { mode: 0o600 });
    const profile = resumePreviewSandbox(directory, cache, [tectonic, pdfinfo, pdftoppm]);
    const run = (binary: string, args: string[]) => runResumePreviewTool(binary, args, directory!, cache, profile, signal);
    const chatter = await run(tectonic, ["--untrusted", "--only-cached", "--color", "never", "--keep-logs", "--reruns", "1", "resume.tex"]);
    const pdfPath = path.join(directory, "resume.pdf"), stat = await fs.lstat(pdfPath);
    if (!stat.isFile() || stat.size > MAX_PDF) throw new ResumeError("Preview PDF exceeds 8 MB.", 422);
    const info = await run(pdfinfo, ["resume.pdf"]);
    const count = Number(info.match(/^Pages:\s+(\d+)\s*$/m)?.[1]);
    if (!Number.isInteger(count) || count < 1 || count > MAX_RESUME_PDF_PAGES) throw new ResumeError("Resume previews support 1–5 pages; no partial preview was used.", 422);
    await run(pdftoppm, ["-f", "1", "-l", String(count), "-scale-to", "1600", "-jpeg", "-jpegopt", "quality=85", "-q", "resume.pdf", "page"]);
    const names = (await fs.readdir(directory)).filter(name => /^page-\d+\.jpg$/.test(name)).sort((a, b) => a.localeCompare(b, "en", { numeric: true }));
    if (names.length !== count) throw new ResumeError("Could not render every preview page.", 422);
    let imageBytes = 0;
    const pages: string[] = [];
    for (const name of names) {
      const file = path.join(directory, name), image = await fs.lstat(file);
      imageBytes += image.size;
      if (!image.isFile() || imageBytes > MAX_IMAGES) throw new ResumeError("Preview images exceed 10 MB.", 422);
      pages.push(`data:image/jpeg;base64,${(await fs.readFile(file)).toString("base64")}`);
    }
    if (signal?.aborted) throw new ResumeError("Preview cancelled", 499);
    const pdf = await fs.readFile(pdfPath);
    if (!pdf.subarray(0, 5).equals(Buffer.from("%PDF-"))) throw new ResumeError("Compiler did not return a PDF.", 422);
    // Warnings (including missing glyphs) must stay visible even when a PDF was produced.
    const log = await fs.readFile(path.join(directory, "resume.log"), "utf8").catch(() => "");
    return { pages, pdf: pdf.toString("base64"), diagnostics: cleanLog(chatter + "\n" + log.split("\n").filter(line => /warning|missing character|overfull|underfull/i.test(line)).join("\n"), directory, cache) };
  } finally {
    try { if (directory) await fs.rm(directory, { recursive: true, force: true }); }
    finally { state.__resumePreviewBusy = false; }
  }
}
