import type { Metadata } from "next";
import { ResearchWorkspace } from "@/components/robin/ResearchWorkspace";

// Static because metadata is rendered on the server, before the viewer's
// locale (which lives in localStorage) is known.
export const metadata: Metadata = {
  title: "Research — Pi Web",
  description: "Research projects with an agent that finds, obtains and reads papers, and keeps the findings in your notebook.",
};

export default function ResearchPage() {
  return <ResearchWorkspace />;
}
