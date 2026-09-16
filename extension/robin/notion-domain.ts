/**
 * Minimal Notion REST client for Robin's read and append-only tools.
 *
 * Server-only. The integration token comes from the settings store and is
 * attached only to api.notion.com requests; it is never returned to a tool.
 */
import { notionSettings } from "./settings.ts";

const NOTION_API = "https://api.notion.com/v1";
const NOTION_VERSION = "2025-09-03";
const REQUEST_TIMEOUT_MS = 15_000;
/** A 20MB slide deck on a slow uplink needs longer than a JSON call. */
const UPLOAD_TIMEOUT_MS = 120_000;
const MAX_READ_BLOCKS = 200;
const MAX_READ_CHARS = 30_000;
const MAX_WRITE_CHARS = 100_000;
const MAX_WRITE_BLOCKS = 100;
const RICH_TEXT_LIMIT = 1_900;

interface NotionPageResponse {
  id: string;
  url?: string;
  last_edited_time?: string;
  properties?: Record<string, unknown>;
  parent?: { type?: string; page_id?: string };
}

interface NotionBlockResponse extends Record<string, unknown> {
  id: string;
  type: string;
  has_children?: boolean;
}

interface NotionChildrenResponse {
  results?: NotionBlockResponse[];
  has_more?: boolean;
  next_cursor?: string | null;
}

interface NotionSearchResponse {
  results?: NotionPageResponse[];
  has_more?: boolean;
  next_cursor?: string | null;
}

export interface NotionPageSummary {
  id: string;
  title: string;
  url?: string;
  lastEditedAt?: string;
  /** Present when the parent is another accessible Notion page. */
  parentId?: string;
}

export interface NotionPageContent extends NotionPageSummary {
  content: string;
  truncated: boolean;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function plainText(value: unknown): string {
  if (!Array.isArray(value)) return "";
  return value.map((item) => {
    const rich = asRecord(item);
    if (!rich) return "";
    if (typeof rich.plain_text === "string") return rich.plain_text;
    const text = asRecord(rich.text);
    return typeof text?.content === "string" ? text.content : "";
  }).join("");
}

function pageTitle(page: NotionPageResponse): string {
  for (const property of Object.values(page.properties ?? {})) {
    const value = asRecord(property);
    if (value?.type === "title") return plainText(value.title) || "Untitled";
  }
  return "Untitled";
}

export function normalizeNotionId(value: string): string {
  const compact = value.trim().replaceAll("-", "").toLowerCase();
  if (!/^[0-9a-f]{32}$/.test(compact)) throw new Error("Invalid Notion page ID");
  return `${compact.slice(0, 8)}-${compact.slice(8, 12)}-${compact.slice(12, 16)}-${compact.slice(16, 20)}-${compact.slice(20)}`;
}

function configuredToken(): string {
  const token = notionSettings().apiToken;
  if (!token) throw new Error("Notion is not configured. Save an integration token in Settings first.");
  return token;
}

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function notionRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = configuredToken();
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const response = await fetch(`${NOTION_API}${path}`, {
      ...init,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      headers: {
        Authorization: `Bearer ${token}`,
        "Notion-Version": NOTION_VERSION,
        "Content-Type": "application/json",
      },
    });
    const body = await response.json().catch(() => null) as T & { message?: unknown } | null;
    if (response.ok && body !== null) return body;
    if (response.status === 429 && attempt < 2) {
      const retryAfter = Number(response.headers.get("retry-after"));
      await wait(Number.isFinite(retryAfter) ? Math.max(250, retryAfter * 1_000) : 1_000);
      continue;
    }
    const message = typeof body?.message === "string"
      ? body.message.slice(0, 500)
      : `Notion returned HTTP ${response.status}`;
    throw new Error(message);
  }
  throw new Error("Notion request failed after retries");
}

export async function searchNotion(query = "", limit = 20): Promise<NotionPageSummary[]> {
  const maximum = Math.max(1, Math.round(limit));
  const pages: NotionPageResponse[] = [];
  let cursor: string | null = null;
  do {
    const response: NotionSearchResponse = await notionRequest<NotionSearchResponse>("/search", {
      method: "POST",
      body: JSON.stringify({
        ...(query.trim() ? { query: query.trim() } : {}),
        filter: { property: "object", value: "page" },
        sort: { direction: "descending", timestamp: "last_edited_time" },
        page_size: Math.min(100, maximum - pages.length),
        ...(cursor ? { start_cursor: cursor } : {}),
      }),
    });
    pages.push(...(response.results ?? []));
    cursor = response.has_more && response.next_cursor && pages.length < maximum ? response.next_cursor : null;
  } while (cursor);

  return pages.slice(0, maximum).map((page) => ({
    id: normalizeNotionId(page.id),
    title: pageTitle(page),
    ...(page.url ? { url: page.url } : {}),
    ...(page.last_edited_time ? { lastEditedAt: page.last_edited_time } : {}),
    ...(page.parent?.type === "page_id" && page.parent.page_id
      ? { parentId: normalizeNotionId(page.parent.page_id) }
      : {}),
  }));
}

function blockText(block: NotionBlockResponse): string {
  const data = asRecord(block[block.type]);
  if (!data) return "";
  const rich = plainText(data.rich_text);
  if (rich) return rich;
  if (typeof data.title === "string") return data.title;
  const external = asRecord(data.external);
  const file = asRecord(data.file);
  if (typeof external?.url === "string") return external.url;
  if (typeof file?.url === "string") return file.url;
  if (typeof data.url === "string") return data.url;
  return "";
}

function renderBlock(block: NotionBlockResponse, depth: number): string {
  const indent = "  ".repeat(depth);
  const value = blockText(block);
  const data = asRecord(block[block.type]);
  switch (block.type) {
    case "heading_1": return `${indent}# ${value}`;
    case "heading_2": return `${indent}## ${value}`;
    case "heading_3": return `${indent}### ${value}`;
    case "bulleted_list_item": return `${indent}- ${value}`;
    case "numbered_list_item": return `${indent}1. ${value}`;
    case "to_do": return `${indent}- [${data?.checked === true ? "x" : " "}] ${value}`;
    case "quote": return `${indent}> ${value}`;
    case "code": return `${indent}\`\`\`\n${value}\n${indent}\`\`\``;
    case "divider": return `${indent}---`;
    case "child_page": return `${indent}↳ ${value || "Untitled page"}`;
    case "child_database": return `${indent}↳ ${value || "Untitled database"}`;
    case "image":
    case "video":
    case "file":
    case "pdf":
    case "bookmark":
    case "link_preview": return value ? `${indent}[${block.type}] ${value}` : "";
    default: return value ? `${indent}${value}` : "";
  }
}

export async function readNotionPage(pageId: string): Promise<NotionPageContent> {
  const id = normalizeNotionId(pageId);
  const page = await notionRequest<NotionPageResponse>(`/pages/${id}`);
  const lines: string[] = [];
  let blockCount = 0;
  let characterCount = 0;
  let truncated = false;

  const walk = async (parentId: string, depth: number): Promise<void> => {
    let cursor: string | null = null;
    do {
      const query = new URLSearchParams({ page_size: "100" });
      if (cursor) query.set("start_cursor", cursor);
      const children = await notionRequest<NotionChildrenResponse>(
        `/blocks/${normalizeNotionId(parentId)}/children?${query}`,
      );
      for (const block of children.results ?? []) {
        if (blockCount >= MAX_READ_BLOCKS || characterCount >= MAX_READ_CHARS) {
          truncated = true;
          return;
        }
        blockCount += 1;
        const line = renderBlock(block, depth);
        if (line) {
          lines.push(line);
          characterCount += line.length + 1;
        }
        if (block.has_children) {
          if (depth < 3) await walk(block.id, depth + 1);
          else truncated = true;
        }
        if (truncated && (blockCount >= MAX_READ_BLOCKS || characterCount >= MAX_READ_CHARS)) return;
      }
      cursor = children.has_more && children.next_cursor ? children.next_cursor : null;
    } while (cursor && !truncated);
  };

  await walk(id, 0);
  return {
    id,
    title: pageTitle(page),
    ...(page.url ? { url: page.url } : {}),
    ...(page.last_edited_time ? { lastEditedAt: page.last_edited_time } : {}),
    content: lines.join("\n").slice(0, MAX_READ_CHARS),
    truncated,
  };
}

function richText(content: string) {
  return [{ type: "text", text: { content } }];
}

function createBlock(type: string, content: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    object: "block",
    type,
    [type]: { rich_text: richText(content), ...extra },
  };
}

function chunks(value: string): string[] {
  const result: string[] = [];
  for (let start = 0; start < value.length; start += RICH_TEXT_LIMIT) {
    result.push(value.slice(start, start + RICH_TEXT_LIMIT));
  }
  return result.length ? result : [""];
}

/** A note's own file, referenced from its Markdown as `![name](attachment:ID)`. */
export interface NotionAttachmentFile {
  id: string;
  name: string;
  kind: "image" | "pdf";
  mimeType: string;
  bytes: Uint8Array;
}

/** A line that is only an attachment reference, as the finalizer places them. */
const ATTACHMENT_LINE = /^!?\[[^\]]*\]\(attachment:([A-Za-z0-9_-]+)\)$/;

/** Convert the small Markdown subset Robin writes into native Notion blocks. */
export function notionBlocksFromMarkdown(markdown: string): Record<string, unknown>[] {
  return markdownToBlocks(markdown).blocks;
}

/**
 * The same conversion, with attachment references turned into the uploaded
 * file's block. `placed` says which were used, so the rest can go at the end.
 */
function markdownToBlocks(
  markdown: string,
  attachmentBlocks: Map<string, Record<string, unknown>> = new Map(),
): { blocks: Record<string, unknown>[]; placed: Set<string> } {
  const placed = new Set<string>();
  const content = markdown.trim();
  if (!content) throw new Error("Note content is required");
  if (content.length > MAX_WRITE_CHARS) throw new Error("Note content is too long");

  const blocks: Record<string, unknown>[] = [];
  const lines = content.replaceAll("\r\n", "\n").split("\n");
  let code: string[] | null = null;

  const add = (type: string, value: string, extra: Record<string, unknown> = {}) => {
    for (const part of chunks(value)) blocks.push(createBlock(type, part, extra));
  };

  for (const raw of lines) {
    if (raw.startsWith("```")) {
      if (code === null) code = [];
      else {
        add("code", code.join("\n"), { language: "plain text" });
        code = null;
      }
      continue;
    }
    if (code !== null) {
      code.push(raw);
      continue;
    }
    const line = raw.trim();
    if (!line) continue;
    const attachment = line.match(ATTACHMENT_LINE);
    if (attachment) {
      const block = attachmentBlocks.get(attachment[1]);
      if (block && !placed.has(attachment[1])) {
        blocks.push(block);
        placed.add(attachment[1]);
      }
      continue;
    }
    const todo = line.match(/^[-*] \[([ xX])\] (.+)$/);
    const bullet = line.match(/^[-*] (.+)$/);
    const numbered = line.match(/^\d+[.)] (.+)$/);
    if (line.startsWith("### ")) add("heading_3", line.slice(4));
    else if (line.startsWith("## ")) add("heading_2", line.slice(3));
    else if (line.startsWith("# ")) add("heading_1", line.slice(2));
    else if (todo) add("to_do", todo[2], { checked: todo[1].toLowerCase() === "x" });
    else if (bullet) add("bulleted_list_item", bullet[1]);
    else if (numbered) add("numbered_list_item", numbered[1]);
    else if (line.startsWith("> ")) add("quote", line.slice(2));
    else add("paragraph", raw.trim());
  }
  if (code !== null) add("code", code.join("\n"), { language: "plain text" });
  if (blocks.length > MAX_WRITE_BLOCKS) throw new Error(`Note has too many blocks (maximum ${MAX_WRITE_BLOCKS})`);
  return { blocks, placed };
}

/**
 * Upload one file with Notion's single-part File Upload API and return its
 * upload id, which a block can then point at. An upload that is never
 * attached to a block expires on Notion's side, so a failed page costs nothing.
 */
async function uploadNotionFile(file: NotionAttachmentFile): Promise<string> {
  const created = await notionRequest<{ id: string }>("/file_uploads", {
    method: "POST",
    body: JSON.stringify({ mode: "single_part", filename: file.name, content_type: file.mimeType }),
  });
  const form = new FormData();
  form.append("file", new Blob([new Uint8Array(file.bytes)], { type: file.mimeType }), file.name);
  const response = await fetch(`${NOTION_API}/file_uploads/${created.id}/send`, {
    method: "POST",
    signal: AbortSignal.timeout(UPLOAD_TIMEOUT_MS),
    headers: { Authorization: `Bearer ${configuredToken()}`, "Notion-Version": NOTION_VERSION },
    body: form,
  });
  if (!response.ok) {
    const body = await response.json().catch(() => null) as { message?: unknown } | null;
    throw new Error(`${file.name}: ${typeof body?.message === "string" ? body.message.slice(0, 300) : `Notion upload failed (HTTP ${response.status})`}`);
  }
  return created.id;
}

function attachmentBlock(file: NotionAttachmentFile, uploadId: string): Record<string, unknown> {
  const type = file.kind === "image" ? "image" : "pdf";
  return {
    object: "block",
    type,
    [type]: { type: "file_upload", file_upload: { id: uploadId }, caption: richText(file.name) },
  };
}

export async function appendNotionPage(pageId: string, markdown: string): Promise<{ blocks: number }> {
  const id = normalizeNotionId(pageId);
  const children = notionBlocksFromMarkdown(markdown);
  await notionRequest(`/blocks/${id}/children`, {
    method: "PATCH",
    body: JSON.stringify({ children }),
  });
  return { blocks: children.length };
}

export async function createNotionPage(
  parentPageId: string,
  title: string,
  markdown: string,
  files: NotionAttachmentFile[] = [],
): Promise<NotionPageSummary & { blocks: number }> {
  const parentId = normalizeNotionId(parentPageId);
  const cleanTitle = title.trim();
  if (!cleanTitle) throw new Error("Page title is required");
  if (cleanTitle.length > 200) throw new Error("Page title is too long");
  // Checked before any upload, so a note that cannot be written spends nothing.
  markdownToBlocks(markdown);
  const uploaded = new Map<string, Record<string, unknown>>();
  for (const file of files) uploaded.set(file.id, attachmentBlock(file, await uploadNotionFile(file)));
  const { blocks: children, placed } = markdownToBlocks(markdown, uploaded);
  // Files the note did not place still belong to it: they go at the end.
  const rest = files.filter((file) => !placed.has(file.id));
  if (rest.length > 0) {
    children.push(createBlock("heading_2", /\p{Script=Han}/u.test(markdown) ? "附件" : "Attachments"));
    for (const file of rest) children.push(uploaded.get(file.id)!);
  }
  if (children.length > MAX_WRITE_BLOCKS) throw new Error(`Note has too many blocks (maximum ${MAX_WRITE_BLOCKS})`);
  const page = await notionRequest<NotionPageResponse>("/pages", {
    method: "POST",
    body: JSON.stringify({
      parent: { page_id: parentId },
      properties: { title: { title: richText(cleanTitle) } },
      children,
    }),
  });
  return {
    id: normalizeNotionId(page.id),
    title: cleanTitle,
    ...(page.url ? { url: page.url } : {}),
    ...(page.last_edited_time ? { lastEditedAt: page.last_edited_time } : {}),
    blocks: children.length,
  };
}
