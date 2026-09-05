import type { Metadata } from "next";
import { FullstackLearningPrototype } from "@/components/robin/FullstackLearningPrototype";

export const metadata: Metadata = {
  title: "Full Stack Learning Prototype — Learning Hub",
  description: "An interactive request map with book-style chapters and a contextual mentor.",
};

export default function FullstackLearningPrototypePage() {
  return <FullstackLearningPrototype />;
}
