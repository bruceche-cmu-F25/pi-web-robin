import type { Metadata } from "next";
import { HeatRunbook } from "@/components/robin/HeatRunbook";

// Static because metadata is rendered on the server, before the viewer's
// locale (which lives in localStorage) is known.
export const metadata: Metadata = {
  title: "Running Samuel's pipeline — Pi Web",
  description: "A runbook for reproducing the HEAT runs: what reproduction can mean at temperature 0.9, the measured cost of both committed runs, the hardcoded edits with no flag, and a symptom-first failure table.",
};

export default function HeatRunbookPage() {
  return <HeatRunbook />;
}
