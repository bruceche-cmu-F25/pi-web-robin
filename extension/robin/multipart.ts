import { randomUUID } from "node:crypto";

type FilePart = { name: string; type?: string; bytes: Uint8Array };

/** Bounded in-memory uploads without Node 26.3.1's leaking Blob.stream() path.
 * Callers already own the bytes and enforce their upload limits. No disk files.
 * Match FormData's CRLF normalization and disposition escaping.
 */
export function multipartBody(parts: [string, string | FilePart][]) {
  const boundary = `----robin-${randomUUID()}`;
  const normalize = (value: string) => value.replace(/\r?\n|\r/g, "\r\n");
  const escape = (value: string) => value.replace(/[\r\n"]/g, ch => ch === "\r" ? "%0D" : ch === "\n" ? "%0A" : "%22");
  const chunks: Uint8Array[] = [];
  for (const [name, value] of parts) {
    const prefix = `--${boundary}\r\nContent-Disposition: form-data; name="${escape(normalize(name))}"`;
    if (typeof value === "string") chunks.push(Buffer.from(`${prefix}\r\n\r\n${normalize(value)}\r\n`));
    else {
      const type = value.type && /^[\x20-\x7e]+$/.test(value.type) ? value.type.toLowerCase() : "application/octet-stream";
      const filename = value.name ? `; filename="${escape(value.name)}"` : "";
      chunks.push(Buffer.from(`${prefix}${filename}\r\nContent-Type: ${type}\r\n\r\n`), value.bytes, Buffer.from("\r\n"));
    }
  }
  chunks.push(Buffer.from(`--${boundary}--\r\n`));
  return { body: Buffer.concat(chunks), contentType: `multipart/form-data; boundary=${boundary}` };
}
