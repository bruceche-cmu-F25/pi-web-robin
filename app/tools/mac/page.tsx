import type { Metadata } from "next";
import { MacWorkspace } from "@/components/robin/MacWorkspace";
export const metadata: Metadata = { title: "Mac monitor & cleanup — Robin" };
export default function MacPage() { return <MacWorkspace />; }
