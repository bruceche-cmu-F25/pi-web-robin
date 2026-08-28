import type { Metadata } from "next";
import { CodingBoard } from "@/components/robin/CodingBoard";

// Static because metadata is rendered on the server, before the viewer's
// locale (which lives in localStorage) is known.
export const metadata: Metadata = {
  title: "Coding — Pi Web",
};

export default function CodingPage() {
  return <CodingBoard />;
}
