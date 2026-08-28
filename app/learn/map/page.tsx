import type { Metadata } from "next";
import { CapabilityAtlas } from "@/components/robin/CapabilityAtlas";

export const metadata: Metadata = {
  title: "Software & AI Engineering World — Learning Hub",
  description: "A progressive industry world model with role depth references, boundaries, mechanisms, and acquisition methods.",
};

export default function CapabilityMapPage() {
  return <CapabilityAtlas />;
}
