import type { Metadata } from "next";
import { ResearchBrief } from "@/components/robin/ResearchBrief";

// Static because metadata is rendered on the server, before the viewer's
// locale (which lives in localStorage) is known.
export const metadata: Metadata = {
  title: "If you are taking this over — Pi Web",
  description: "A takeover briefing for the HEAT project: what to trust, what will bite you, what is in the input files, who holds what, and the first week.",
};

export default function ResearchBriefPage() {
  return <ResearchBrief />;
}
