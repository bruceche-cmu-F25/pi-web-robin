import assert from "node:assert/strict";
import { test } from "node:test";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import net from "node:net";
import { createJiti } from "jiti";
const jiti = createJiti(import.meta.url);
const { compileResumePreview, resumePreviewSandbox, runResumePreviewTool, resumeTexCache } = await jiti.import("./resume-preview.ts");
const { RESUME_TEMPLATE } = await jiti.import("../extension/robin/resume.ts");
const ready = os.platform() === "darwin" && await fs.access(path.join(resumeTexCache(), "formats")).then(() => true, () => false);
const doc = text => `\\documentclass{article}\n\\begin{document}\n${text}\n\\end{document}`;

test("invalid or aborted input is rejected before compiler setup", async () => {
  for (const input of [null, {}, "", "\0"]) await assert.rejects(compileResumePreview(input));
  await assert.rejects(compileResumePreview("x".repeat(200001)), error => error.status === 413);
  await assert.rejects(compileResumePreview(doc("valid"), AbortSignal.abort()), error => error.status === 499);
});

test("real offline compilation renders Latin and Chinese, all pages, without saving a resume", { skip: !ready, timeout: 60_000 }, async () => {
  const latin = await compileResumePreview(RESUME_TEMPLATE);
  assert.equal(latin.pages.length, 1); assert.match(latin.pages[0], /^data:image\/jpeg;base64,\/9j/);
  assert.equal(Buffer.from(latin.pdf, "base64").subarray(0, 5).toString(), "%PDF-");
  const chinese = await compileResumePreview(String.raw`\documentclass[fontset=fandol]{ctexart}\begin{document}中文简历\textbf{繁體履歷}\newpage 第二页\end{document}`);
  assert.equal(chinese.pages.length, 2);
  assert.doesNotMatch(chinese.diagnostics, /Missing character:/i);
  const missingGlyphs = await compileResumePreview(doc("Check 中文"));
  assert.match(missingGlyphs.diagnostics, /Missing character:/i);
  await fs.writeFile("/tmp/resume-preview-chinese.pdf", Buffer.from(chinese.pdf, "base64"));
  await fs.writeFile("/tmp/resume-preview-latin.jpg", Buffer.from(latin.pages[0].split(",")[1], "base64"));
  await fs.writeFile("/tmp/resume-preview-fixture.json", JSON.stringify(latin));
});

test("legacy T1/inputenc/lmodern structured resumes render without changing the source", { skip: !ready, timeout: 60_000 }, async () => {
  const source = await fs.readFile(new URL("../extension/robin/fixtures/resume-legacy.tex", import.meta.url), "utf8");
  for (const size of [10, 11, 12]) {
    for (const modern of [true, false]) {
      const sized = source.replace("10pt,letterpaper", `${size}pt,letterpaper`);
      const document = modern ? sized : sized.replace(String.raw`\usepackage{lmodern}`, "")
        .replace(String.raw`\usepackage[T1]{fontenc}`, String.raw`\renewcommand{\rmdefault}{cmr}\usepackage[T1]{fontenc}`);
      const result = await compileResumePreview(document);
      assert.equal(result.pages.length, 1);
      assert.doesNotMatch(result.diagnostics, /Missing character:|not loadable|font shape .* undefined/i);
      if (size === 10 && modern) {
        await fs.writeFile("/tmp/resume-preview-legacy.pdf", Buffer.from(result.pdf, "base64"));
        await fs.writeFile("/tmp/resume-preview-legacy.jpg", Buffer.from(result.pages[0].split(",")[1], "base64"));
      }
    }
  }
});

test("fractional 8.4pt contacts and 21pt headings need fonts beyond class/body size", { skip: !ready, timeout: 60_000 }, async () => {
  // Screenshot regression: T1 without an explicit lmodern package, 9pt body, 21pt heading.
  const source = String.raw`\documentclass[10pt,letterpaper]{article}
\usepackage[margin=0.5in]{geometry}
\usepackage[T1]{fontenc}
\usepackage{enumitem,titlesec}
\usepackage[hidelinks]{hyperref}
\pagestyle{empty}
\begin{document}
\fontsize{9}{10.5}\selectfont
\begin{center}
{\fontsize{21}{23}\selectfont\bfseries Example Candidate\par}
\vspace{3pt}
{\fontsize{8.4}{10}\selectfont Example City \textbar\ \href{mailto:example@example.com}{example@example.com}\par}
\end{center}
\section*{PROFILE}
Synthetic structured resume: \textbf{bold}, \textit{italic}, and ordinary text.
\begin{itemize}\item A readable project bullet.\end{itemize}
\end{document}`;
  const result = await compileResumePreview(source);
  assert.equal(result.pages.length, 1);
  assert.doesNotMatch(result.diagnostics, /Missing character:|not loadable/i);
  await fs.writeFile("/tmp/resume-preview-fractional.jpg", Buffer.from(result.pages[0].split(",")[1], "base64"));
  // A URL initializes OT1 math fonts even when the visible document uses T1 text.
  const legacy = await fs.readFile(new URL("../extension/robin/fixtures/resume-legacy.tex", import.meta.url), "utf8");
  const linked = legacy.replace(String.raw`\usepackage{lmodern}`, "")
    .replace(String.raw`\begin{center}`, String.raw`\begin{center}\fontsize{8.4}{10}\selectfont`)
    .replace(String.raw`\Large\bfseries`, String.raw`\fontsize{21}{23}\selectfont\bfseries`);
  assert.equal((await compileResumePreview(linked)).pages.length, 1);
});

test("all prepared optical sizes and faces render with read-only offline resources", { skip: !ready, timeout: 60_000 }, async () => {
  const modern = await fs.readFile(new URL("../extension/robin/fixtures/resume-font-sizes.tex", import.meta.url), "utf8");
  const classic = modern.replace(String.raw`\usepackage{lmodern}`, "")
    .replace(String.raw`\usepackage[T1]{fontenc}`, String.raw`\renewcommand{\rmdefault}{cmr}\usepackage[T1]{fontenc}`);
  for (const source of [modern, classic]) {
    const result = await compileResumePreview(source);
    assert.ok(result.pages.length > 0);
    assert.doesNotMatch(result.diagnostics, /Missing character:|not loadable/i);
  }
});

test("syntax errors, uncached dependencies and excessive pages fail without partial success", { skip: !ready, timeout: 60_000 }, async () => {
  await assert.rejects(compileResumePreview(doc("\\undefinedResumeCommand")), /Undefined control sequence/);
  await assert.rejects(compileResumePreview(RESUME_TEMPLATE.replace("\\usepackage{enumitem}", "\\usepackage{missing-resume-package-xyz}")), /not found|could not|can't find/i);
  await assert.rejects(compileResumePreview(doc(Array.from({ length: 6 }, (_, i) => `Page ${i}`).join("\\newpage "))), /1–5 pages/);
});

test("Seatbelt denies secret reads, traversal, cache/outside writes, network and unlisted executables", { skip: !ready, timeout: 30_000 }, async () => {
  const parent = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "resume-sandbox-test-")));
  const directory = path.join(parent, "work"), cache = path.join(parent, "cache");
  await fs.mkdir(directory); await fs.mkdir(cache);
  await fs.writeFile(path.join(parent, "secret.txt"), "PRIVATE_SENTINEL\n");
  await fs.symlink(path.join(parent, "secret.txt"), path.join(directory, "linked.txt"));
  const profile = resumePreviewSandbox(directory, cache, ["/bin/bash"]);
  const run = script => runResumePreviewTool("/bin/bash", ["--noprofile", "--norc", "-c", script], directory, cache, profile);
  const server = net.createServer(socket => socket.destroy()); let connected = false;
  server.on("connection", () => { connected = true; });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  try {
    assert.equal((await run("printf allowed > local.txt; printf ok")).trim(), "ok");
    for (const file of ["../secret.txt", "linked.txt", path.join(parent, "secret.txt")]) {
      await assert.rejects(run(`IFS= read -r value < '${file}'; exit $?`), /not permitted|denied/i);
    }
    await assert.rejects(run("printf forbidden > ../outside.txt"), /not permitted|denied/i);
    await assert.rejects(run("printf forbidden > ../cache/poison"), /not permitted|denied/i);
    await assert.rejects(run("exec /bin/echo forbidden"), /not permitted|denied/i);
    await assert.rejects(run(`printf forbidden > /dev/tcp/127.0.0.1/${server.address().port}`), /not permitted|denied/i);
    assert.equal(connected, false);
    await assert.rejects(fs.access(path.join(parent, "outside.txt")));
    await assert.rejects(fs.access(path.join(cache, "poison")));
    await assert.rejects(runResumePreviewTool("/bin/bash", ["-c", "while :; do :; done"], directory, cache, profile, undefined, 100), /time limit/);
    await assert.rejects(run("printf '%200000s' ''"), /output exceeded/);
    // The subprocess gets no credential-bearing parent environment.
    process.env.RESUME_TEST_SECRET = "PRIVATE_ENV_SENTINEL";
    assert.doesNotMatch(await run("printf '%s' \"$RESUME_TEST_SECRET\""), /PRIVATE_ENV_SENTINEL/);
  } finally { delete process.env.RESUME_TEST_SECRET; await new Promise(resolve => server.close(resolve)); await fs.rm(parent, { recursive: true, force: true }); }
});

test("TeX cannot read outside its directory; abort releases the compiler only after termination", { skip: !ready, timeout: 40_000 }, async () => {
  await assert.rejects(compileResumePreview(doc(String.raw`\input{../../../../../../../../../etc/passwd}`)), /not permitted|forbidden|denied/i);
  const controller = new AbortController();
  const running = compileResumePreview(doc(String.raw`\loop\iftrue\repeat`), controller.signal);
  await assert.rejects(compileResumePreview(RESUME_TEMPLATE), error => error.status === 429);
  setTimeout(() => controller.abort(), 300);
  await assert.rejects(running, error => error.status === 499);
  assert.equal((await compileResumePreview(RESUME_TEMPLATE)).pages.length, 1);
});
