import type { Metadata } from "next";
import { ToolboxWorkspace } from "@/components/robin/ToolboxWorkspace";

export const metadata: Metadata = { title: "Local toolbox — Pi Web", description: "Private, local file conversion and everyday utilities." };
export default function ToolsPage() { return <ToolboxWorkspace />; }
