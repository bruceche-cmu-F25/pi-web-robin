import type { Metadata } from "next";
import { FsoWorkspace } from "@/components/robin/FsoWorkspace";

export const metadata: Metadata = {
  title: "Full Stack Open — Learning Hub",
  description: "The Full Stack Open course as a roadmap, each chapter framed beside your notes and a mentor.",
};

export default function FullStackOpenPage() {
  return <FsoWorkspace />;
}
