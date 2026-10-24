import { createHash } from "node:crypto";
import { dataPath, readJsonObject, updateJsonObject, withFileLock } from "./paths.ts";
import { appendResearchNote, getResearchProject, readResearchConversation } from "./research-domain.ts";
import { listPapers, paperText, PaperError } from "./papers-domain.ts";
import { createNoteDraft } from "./notes-domain.ts";
import { archiveNoteToObsidian, listObsidianVaults, resolveObsidianVault, type ObsidianArchive, type ObsidianVault } from "./obsidian-domain.ts";

const FILE = "research-captures.json";
interface Destination { id: string; path: string }
export interface ResearchCapture {
  messageId: string; notebookSaved: boolean; archive?: ObsidianArchive; error?: string;
}
interface StoredCapture extends ResearchCapture {
  projectId: string; title: string; text: string; markdown: string; vault?: Destination; draftId?: string;
}
interface CaptureFile { captures: Record<string, StoredCapture>; destinations: Record<string, Destination> }
export interface ResearchCaptures {
  captures: ResearchCapture[]; vaults: ObsidianVault[]; vaultId: string; vaultError?: string;
}
const empty = (): CaptureFile => ({ captures: {}, destinations: {} });
function read(): CaptureFile { return readJsonObject<CaptureFile>(FILE) ?? empty(); }
function publicCapture({ messageId, notebookSaved, archive, error }: StoredCapture): ResearchCapture {
  return { messageId, notebookSaved, archive, error };
}
/** Read-only status: a broken registry must not prevent reading the project notebook. */
export function readResearchCaptures(projectId: string): ResearchCaptures {
  const state = read();
  let vaults: ObsidianVault[] = [], vaultError: string | undefined;
  try { vaults = listObsidianVaults(); }
  catch (error) { vaultError = error instanceof Error ? error.message : String(error); }
  return { captures: Object.values(state.captures).filter((item) => item.projectId === projectId).map(publicCapture), vaults,
    vaultId: state.destinations[projectId]?.id ?? (vaults.length === 1 ? vaults[0].id : ""), vaultError };
}

/** A human's Keep click archives exactly that saved answer, never browser-supplied Markdown. */
export function captureResearchMessage(projectId: string, messageId: unknown, requestedVault?: unknown): ResearchCapture {
  const project = getResearchProject(projectId);
  const id = paperText(messageId, 100, true);
  const vaultId = requestedVault === undefined ? "" : paperText(requestedVault, 100);
  const key = createHash("sha256").update(JSON.stringify([projectId, id])).digest("hex");
  // Local, synchronous publications only. One lock serializes captures and their retry checkpoints.
  return withFileLock(dataPath("research-capture-operation"), () => {
    let capture = read().captures[key];
    if (!capture) {
      const message = readResearchConversation(projectId).messages.find((item) => item.id === id && item.role === "assistant");
      if (!message) throw new PaperError("Research answer not found in this project", 404);
      const ids = new Set([...message.text.matchAll(/[?&]paper=([a-zA-Z0-9-]+)/g)].map((match) => match[1]));
      if (message.paperId) ids.add(message.paperId);
      const papers = listPapers().filter((item) => ids.has(item.id));
      const sources = papers.map((item) => {
        const title = item.title.replace(/[\[\]\\\r\n]/g, " ");
        return item.url ? `- [${title}](<${item.url}>)` : `- ${title} (uploaded PDF / 上传 PDF; paper ID: ${item.id})`;
      });
      const date = message.at.slice(0, 10);
      const title = `${project.name} · ${papers[0]?.title ?? "Research discussion"} · ${date}`.slice(0, 200);
      const text = `### ${date} · 研究讨论 / Research discussion\n\n${message.text}${sources.length ? `\n\n来源 / Sources:\n${sources.join("\n")}` : ""}`;
      const markdown = ["---", `title: ${JSON.stringify(title)}`, `project: ${JSON.stringify(project.name)}`,
        `message_id: ${JSON.stringify(id)}`, `source_time: ${JSON.stringify(message.at)}`, "tags: [research, capture]", "---", "",
        `# ${title.replace(/[\r\n]/g, " ")}`, "", `Project: [[${project.name.replace(/[\[\]|\r\n]/g, " ")}]]`, "", text, "",
        "> AI-generated research discussion; verify claims against the original sources. / AI 研究讨论，请对照原文核实。", ""].join("\n");
      paperText(markdown, 100_000, true);
      capture = { projectId, messageId: id, title, text, markdown, notebookSaved: false };
    }
    const save = () => updateJsonObject<CaptureFile, void>(FILE, (stored) => {
      const state = stored ?? empty();
      state.captures[key] = capture;
      return { value: state, result: undefined, changed: true };
    });
    if (capture.archive) return publicCapture(capture);
    save(); // Freeze source/date before either write; retries still work if the thread is later trimmed.
    try {
      if (!capture.notebookSaved) {
        appendResearchNote(capture.text, projectId);
        capture.notebookSaved = true;
        save();
      }
      const preferred = read().destinations[projectId];
      const selected = capture.vault ?? (!vaultId || preferred?.id === vaultId ? preferred : undefined);
      const available = listObsidianVaults();
      const targetId = selected?.id || vaultId || (available.length === 1 ? available[0].id : "");
      if (!targetId) throw new PaperError(available.length ? "Choose an Obsidian vault in the project notebook, then retry." : "Open a vault in Obsidian on the server computer, then retry.");
      const vault = resolveObsidianVault(targetId);
      if (selected && selected.path !== vault.path) throw new PaperError("The Obsidian vault location changed; nothing was written to the new location.", 409);
      const newDestination = !capture.vault;
      capture.vault = { id: vault.id, path: vault.path };
      if (!capture.draftId) capture.draftId = createNoteDraft({ title: capture.title, text: capture.markdown }).id;
      updateJsonObject<CaptureFile, void>(FILE, (stored) => {
        const state = stored ?? empty();
        state.captures[key] = capture;
        if (newDestination) state.destinations[projectId] = capture.vault!;
        return { value: state, result: undefined, changed: true };
      }); // Persist the stable draft and destination before publishing into the vault.
      capture.archive = archiveNoteToObsidian({ confirmed: true, vaultId: vault.id, draftId: capture.draftId,
        title: capture.title, content: capture.markdown, expectedDraft: { title: capture.title, text: capture.markdown }, attachmentIds: [] });
      delete capture.error;
    } catch (error) {
      capture.error = error instanceof Error ? error.message : String(error);
    }
    save();
    return publicCapture(capture);
  });
}
