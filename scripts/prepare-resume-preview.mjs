// One-time, operator-invoked package preparation. Never accepts a document/path from a user/API.
// Only these fixed public templates may download TeX resources. Actual previews are offline.
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { RESUME_TEMPLATE } from "../extension/robin/resume.ts";
if (os.platform() !== "darwin") throw new Error("Preview currently requires macOS sandbox-exec.");
const cache = path.join(os.homedir(), "Library", "Caches", "pi-web-resume", "tectonic");
const directory = await fs.mkdtemp(path.join(os.tmpdir(), "resume-tex-setup-"));
const binary = (await Promise.all(["/opt/homebrew/bin/tectonic", "/usr/local/bin/tectonic"].map(p => fs.realpath(p).catch(() => null)))).find(Boolean);
if (!binary) throw new Error("Install Tectonic first: brew install tectonic poppler");
try {
  await fs.mkdir(cache, { recursive: true });
  const common = RESUME_TEMPLATE.replace("\\begin{document}", String.raw`\usepackage{fontspec,fontawesome5,xcolor,tabularx,titlesec,fancyhdr,multicol,ragged2e,changepage,latexsym,marvosym}
\begin{document}
\faGithub`);
  // fontspec/TU does not warm T1/inputenc/Latin Modern used by many existing resumes.
  // Keep a real structured fixture, not just a list of package imports: fonts load lazily.
  const legacy = await fs.readFile(new URL("../extension/robin/fixtures/resume-legacy.tex", import.meta.url), "utf8");
  const legacyDocuments = [];
  for (const size of [10, 11, 12]) {
    const source = legacy.replace("10pt,letterpaper", `${size}pt,letterpaper`);
    legacyDocuments.push([`legacy-lmodern-${size}`, source]);
    legacyDocuments.push([`legacy-cmr-${size}`, source.replace(String.raw`\usepackage{lmodern}`, "")
      .replace(String.raw`\usepackage[T1]{fontenc}`, String.raw`\renewcommand{\rmdefault}{cmr}\usepackage[T1]{fontenc}`)]);
  }
  // NFSS chooses optical-size files lazily: 8.4pt needs ec-lmr8, not the 9pt body font.
  // Ship actual glyphs for the full size/face matrix so metrics AND outline files are cached.
  const fontSizes = await fs.readFile(new URL("../extension/robin/fixtures/resume-font-sizes.tex", import.meta.url), "utf8");
  legacyDocuments.push(["lmodern-all-sizes-and-faces", fontSizes]);
  legacyDocuments.push(["cmr-all-sizes-and-faces", fontSizes.replace(String.raw`\usepackage{lmodern}`, "")
    .replace(String.raw`\usepackage[T1]{fontenc}`, String.raw`\renewcommand{\rmdefault}{cmr}\usepackage[T1]{fontenc}`)]);
  for (const [name, source] of [["latin", common], ...legacyDocuments, ["chinese", String.raw`\documentclass[fontset=fandol]{ctexart}
\usepackage[margin=1.6cm]{geometry}
\usepackage{enumitem,hyperref}
\begin{document}中文简历 繁體履歷\textbf{项目經驗}\textit{教育背景}\end{document}`]]) {
    console.log(`Preparing offline TeX resources: ${name}…`);
    await fs.writeFile(path.join(directory, "prepare.tex"), source);
    const { stdout, stderr } = await promisify(execFile)(binary, ["--untrusted", "--color", "never", "prepare.tex"], {
      cwd: directory, timeout: 300_000, maxBuffer: 2 * 1024 * 1024,
      env: { PATH: "/usr/bin:/bin", HOME: directory, TMPDIR: directory, TECTONIC_CACHE_DIR: cache, LANG: "en_US.UTF-8" },
    });
    console.log(stdout, stderr);
  }
  console.log("Offline resume preview packages are ready. Preview requests cannot download extra packages.");
} finally { await fs.rm(directory, { recursive: true, force: true }); }
