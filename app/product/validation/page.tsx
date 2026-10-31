import type { Metadata } from "next";
import { Suspense } from "react";
import { ValidationWorkspace } from "@/components/robin/ValidationWorkspace";

export const metadata: Metadata = { title: "Market validation — Pi Web" };

export default function ValidationPage() {
  return <Suspense><ValidationWorkspace /></Suspense>;
}
