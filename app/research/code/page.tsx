import type { Metadata } from "next";
import { CodeWalkthrough } from "@/components/robin/CodeWalkthrough";

// Static because metadata is rendered on the server, before the viewer's
// locale (which lives in localStorage) is known.
export const metadata: Metadata = {
  title: "visualize.py line by line — Pi Web",
  description: "A complete walkthrough of the HEAT pipeline's single source file: every line from 1 to 1,623 in exactly one annotated block.",
};

export default function CodeWalkthroughPage() {
  return <CodeWalkthrough />;
}
