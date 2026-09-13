import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { CodingBoard } from "@/components/robin/CodingBoard";

// Static because metadata is rendered on the server, before the viewer's
// locale (which lives in localStorage) is known.
export const metadata: Metadata = {
  title: "Coding — Pi Web",
};

export default async function CodingPage({ searchParams }: { searchParams: Promise<{ track?: string }> }) {
  // The curriculum track is gone; its old links land on the course that replaced it.
  if ((await searchParams).track === "curriculum") redirect("/learn/fso");
  return <CodingBoard />;
}
