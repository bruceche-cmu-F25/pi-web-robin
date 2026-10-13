import type { Metadata } from "next";
import { KanbanBoard } from "@/components/robin/KanbanBoard";

export const metadata: Metadata = { title: "Kanban — Pi Web" };

export default function KanbanPage() {
  return <KanbanBoard />;
}
