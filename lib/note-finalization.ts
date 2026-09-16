export interface FinalizedNote {
  title: string;
  content: string;
}

/** Parse the tiny envelope requested from the model; preserve useful output if it misses the format. */
export function parseFinalizedNote(reply: string, fallbackTitle: string): FinalizedNote {
  const match = reply.trim().match(/^<title>\s*([\s\S]*?)\s*<\/title>\s*<note>\s*([\s\S]*?)\s*<\/note>$/i);
  if (!match) return { title: fallbackTitle, content: reply.trim() };
  return {
    title: match[1].replaceAll("\n", " ").trim().slice(0, 200) || fallbackTitle,
    content: match[2].trim(),
  };
}
