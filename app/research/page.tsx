import type { Metadata } from "next";
import { ResearchStack } from "@/components/robin/ResearchStack";

// Static because metadata is rendered on the server, before the viewer's
// locale (which lives in localStorage) is known.
export const metadata: Metadata = {
  title: "HEAT research stack — Pi Web",
  description: "Every term, model, dataset, metric and tool the HEAT hallucination-detection pipeline runs on, with what it is, why it exists, and how this codebase uses it.",
};

export default function ResearchPage() {
  return <ResearchStack />;
}
