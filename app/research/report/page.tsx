import type { Metadata } from "next";
import { ResearchReport } from "@/components/robin/ResearchReport";

// Static because metadata is rendered on the server, before the viewer's
// locale (which lives in localStorage) is known.
export const metadata: Metadata = {
  title: "HEAT: where the project stands — Pi Web",
  description: "A takeover report on the HEAT hallucination-detection project: provenance, method, results, and a ledger of which claims the artifacts actually support.",
};

export default function ResearchReportPage() {
  return <ResearchReport />;
}
