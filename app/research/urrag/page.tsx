import type { Metadata } from "next";
import { UrRagArchitecture } from "@/components/robin/UrRagArchitecture";

// Static because metadata is rendered on the server, before the viewer's
// locale (which lives in localStorage) is known.
export const metadata: Metadata = {
  title: "UR-RAG, the system underneath — Pi Web",
  description: "An orientation to the real HEAT source repository: the package map, the offline pipeline, the three labels everything rests on, the risk arithmetic, and the two-tier controller.",
};

export default function UrRagArchitecturePage() {
  return <UrRagArchitecture />;
}
