import type { Metadata } from "next";
import { ObsidianWorkspace } from "@/components/robin/ObsidianWorkspace";

export const metadata: Metadata = {
  title: "Obsidian — Pi Web",
  description: "Browse your local Obsidian vault, read Markdown and explore linked notes.",
};

export default function ObsidianPage() {
  return <ObsidianWorkspace />;
}
