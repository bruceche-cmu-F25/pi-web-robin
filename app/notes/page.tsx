import type { Metadata } from "next";
import { NotesWorkspace } from "@/components/robin/NotesWorkspace";

export const metadata: Metadata = {
  title: "Notes — Pi Web",
  description: "Capture Markdown notes, refine them with an agent, and archive them to Notion.",
};

export default function NotesPage() {
  return <NotesWorkspace />;
}
