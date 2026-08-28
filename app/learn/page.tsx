import type { Metadata } from "next";
import { LearningHub } from "@/components/robin/LearningHub";

// Static because metadata is rendered on the server, before the viewer's
// locale (which lives in localStorage) is known.
export const metadata: Metadata = {
  title: "Learning Hub — Pi Web",
};

export default function LearnPage() {
  return <LearningHub />;
}
