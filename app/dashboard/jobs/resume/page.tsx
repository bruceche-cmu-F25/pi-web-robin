import type { Metadata } from "next";
import { ResumeWorkspace } from "@/components/robin/ResumeWorkspace";

export const metadata: Metadata = { title: "Resume — Pi Web" };
export default function ResumePage() { return <ResumeWorkspace />; }
