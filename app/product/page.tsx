import type { Metadata } from "next";
import { ProductIdeas } from "@/components/robin/ProductIdeas";
import { ProductIncubatorShell } from "@/components/robin/ProductIncubatorShell";

export const metadata: Metadata = { title: "Product — Pi Web" };

export default function ProductPage() {
  return <ProductIncubatorShell><ProductIdeas /></ProductIncubatorShell>;
}
