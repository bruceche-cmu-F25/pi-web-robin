import { redirect } from "next/navigation";

export default async function OutreachPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  // Keep previously shared batch links usable; the default entry is now the CRM.
  if (typeof params.channel === "string") {
    const query = new URLSearchParams({ channel: params.channel });
    if (typeof params.ids === "string") query.set("ids", params.ids);
    redirect(`/outreach/batch?${query}`);
  }
  redirect("/outreach/research");
}
