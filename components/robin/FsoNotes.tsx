"use client";

import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from "react";
import { MarkdownBody } from "@/components/MarkdownBody";
import { useI18n } from "@/hooks/useI18n";
import { FSO_PARTS, type FsoChapter } from "@/extension/robin/fso";
import type { FsoNote } from "@/extension/robin/fso-domain";
import styles from "./FsoWorkspace.module.css";

const SAVE_DELAY_MS = 800;

type SaveState = "idle" | "dirty" | "saving" | "saved" | "error";

export interface FsoNoteEditorHandle {
  /** Write whatever is pending now; resolves once the server has it. */
  flush: () => Promise<void>;
  /** Append text (a mentor reply) to the note and save it. */
  append: (text: string) => void;
}

/** Browsers refuse a keepalive request whose body is over 64 KiB; leave room for headers. */
const KEEPALIVE_MAX_BYTES = 60_000;

async function putNote(chapter: string, text: string, keepalive = false): Promise<FsoNote | null> {
  const body = JSON.stringify({ chapter, text });
  const response = await fetch("/api/robin/fso", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body,
    // A long CJK note can pass the character limit and still exceed the byte
    // cap. A plain request then still lands on a chapter switch; only a
    // closing tab can cut it off.
    keepalive: keepalive && new TextEncoder().encode(body).length <= KEEPALIVE_MAX_BYTES,
  });
  const result = await response.json().catch(() => null) as { note?: FsoNote | null; error?: string } | null;
  if (!response.ok) throw new Error(result?.error ?? `Request failed (${response.status})`);
  return result?.note ?? null;
}

/**
 * One chapter's note, saved as you type.
 *
 * Mounted per chapter (the parent keys it), so switching chapters flushes the
 * old note on the way out and starts the new one from what the server has.
 */
export const FsoNoteEditor = forwardRef<FsoNoteEditorHandle, {
  chapter: FsoChapter;
  note: FsoNote | undefined;
  onSaved: (chapterId: string, note: FsoNote | null) => void;
  onAskMentor: () => void;
}>(function FsoNoteEditor({ chapter, note, onSaved, onAskMentor }, ref) {
  const { t } = useI18n();
  const [text, setText] = useState(note?.text ?? "");
  const [state, setState] = useState<SaveState>("idle");
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState(false);
  const textRef = useRef(text);
  const savedRef = useRef(note?.text ?? "");
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const save = useCallback(async () => {
    clearTimeout(timer.current);
    const value = textRef.current;
    if (value === savedRef.current) return;
    setState("saving");
    try {
      const saved = await putNote(chapter.id, value);
      savedRef.current = value;
      onSaved(chapter.id, saved);
      setError(null);
      setState(textRef.current === value ? "saved" : "dirty");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
      setState("error");
    }
  }, [chapter.id, onSaved]);

  const change = useCallback((value: string) => {
    textRef.current = value;
    setText(value);
    setState("dirty");
    clearTimeout(timer.current);
    timer.current = setTimeout(() => void save(), SAVE_DELAY_MS);
  }, [save]);

  useImperativeHandle(ref, () => ({
    flush: save,
    append: (addition: string) => {
      const current = textRef.current.trimEnd();
      change(current ? `${current}\n\n${addition.trim()}\n` : `${addition.trim()}\n`);
      setPreview(false);
    },
  }), [save, change]);

  const onSavedRef = useRef(onSaved);
  useEffect(() => { onSavedRef.current = onSaved; });

  // Leaving the chapter (or the page) must not drop the last few keystrokes.
  // The parent hears about them straight away, not when the write returns:
  // coming back to this chapter before the next poll remounts the editor from
  // the parent's copy, and a stale copy there would be saved over this one.
  useEffect(() => () => {
    clearTimeout(timer.current);
    const text = textRef.current;
    if (text === savedRef.current) return;
    onSavedRef.current(chapter.id, text.trim() ? { text, updatedAt: new Date().toISOString() } : null);
    void putNote(chapter.id, text, true)
      .then((saved) => onSavedRef.current(chapter.id, saved))
      .catch(() => undefined);
  }, [chapter.id]);

  const status = state === "saving" ? t("fso.notes.saving")
    : state === "saved" ? t("fso.notes.saved")
      : state === "dirty" ? t("fso.notes.unsaved")
        : state === "error" ? error ?? t("fso.notes.error")
          : note ? t("fso.notes.updated", { date: note.updatedAt.slice(0, 10) }) : "";

  return (
    <div className={styles.notes}>
      <div className={styles.notesHead}>
        <h3>{chapter.part}{chapter.letter} · {chapter.title}</h3>
        <span className={styles.notesStatus} data-state={state} role="status">{status}</span>
      </div>
      {preview ? (
        <div className={styles.notesPreview}>
          {text.trim() ? <MarkdownBody className="pi-prose">{text}</MarkdownBody>
            : <p className={styles.notesHint}>{t("fso.notes.emptyPreview")}</p>}
        </div>
      ) : (
        <textarea
          className={styles.notesEditor}
          value={text}
          onChange={(event) => change(event.target.value)}
          onBlur={() => void save()}
          onKeyDown={(event) => {
            if ((event.metaKey || event.ctrlKey) && event.key === "s") {
              event.preventDefault();
              void save();
            }
          }}
          placeholder={t("fso.notes.placeholder")}
          aria-label={t("fso.notes.label", { chapter: chapter.title })}
          spellCheck={false}
        />
      )}
      <div className={styles.notesFoot}>
        <button type="button" className="ui-action pi-chrome-label pi-bracket" style={{ fontSize: 10 }}
          onClick={() => setPreview((value) => !value)} aria-pressed={preview}>
          {t(preview ? "fso.notes.edit" : "fso.notes.preview")}
        </button>
        <button type="button" className="ui-action pi-chrome-label pi-bracket" style={{ fontSize: 10 }}
          data-state="accent" disabled={!text.trim()}
          onClick={async () => {
            await save();
            onAskMentor();
          }}>
          {t("fso.notes.askMentor")}
        </button>
      </div>
    </div>
  );
});

/** Every note, in course order — the part of the course you wrote. */
export function FsoNotebook({ notes, onOpen }: {
  notes: Record<string, FsoNote>;
  onOpen: (chapter: FsoChapter) => void;
}) {
  const { t } = useI18n();
  const parts = FSO_PARTS
    .map((part) => ({ part, chapters: part.chapters.filter((chapter) => notes[chapter.id]) }))
    .filter((entry) => entry.chapters.length > 0);
  const count = parts.reduce((sum, entry) => sum + entry.chapters.length, 0);

  return (
    <div className={styles.roadmapScroll}>
      <article className={styles.notebook}>
        <header>
          <p className="pi-eyebrow">Full Stack Open · {t("fso.notebook.count", { count })}</p>
          <h1>{t("fso.notebook.title")}</h1>
        </header>
        {count === 0 && <p className={styles.empty}>{t("fso.notebook.empty")}</p>}
        {parts.map(({ part, chapters }) => (
          <section key={part.part} className={styles.notebookPart}>
            <h2><span>{t("fso.part", { part: part.part })}</span><span>{part.title}</span></h2>
            {chapters.map((chapter) => (
              <div key={chapter.id} className={styles.notebookEntry}>
                <header>
                  <h3>{chapter.part}{chapter.letter} · {chapter.title}</h3>
                  <span className="flex items-baseline gap-3">
                    <span className="pi-eyebrow">{notes[chapter.id].updatedAt.slice(0, 10)}</span>
                    <button type="button" className="ui-action pi-chrome-label pi-bracket" style={{ fontSize: 10 }}
                      onClick={() => onOpen(chapter)}>
                      {t("fso.notebook.open")}
                    </button>
                  </span>
                </header>
                <MarkdownBody className="pi-prose">{notes[chapter.id].text}</MarkdownBody>
              </div>
            ))}
          </section>
        ))}
      </article>
    </div>
  );
}
