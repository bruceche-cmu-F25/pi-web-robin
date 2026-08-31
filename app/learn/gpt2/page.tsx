import type { Metadata } from "next";
import { GPT2Walkthrough } from "@/components/robin/GPT2Walkthrough";

export const metadata: Metadata = {
  title: "GPT-2 Walkthrough — Learning Hub",
  description: "A focused study page for Andrej Karpathy's GPT-2 walkthrough.",
};

export default function GPT2Page() {
  return <GPT2Walkthrough />;
}
