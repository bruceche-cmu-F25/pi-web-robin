"use client";

import { useEffect, useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import type { Paper } from "@/extension/robin/papers-domain";
import type { ObsidianArchive, ObsidianVault } from "@/extension/robin/obsidian-domain";
import { researchJson, researchRequest } from "./research-client";
import s from "./ResearchWorkspace.module.css";

type Preview = { title: string; content: string; revision: number };
export function PaperExport({ paper, onChange }: { paper: Paper; onChange: (paper: Paper) => void }) {
  const { t } = useI18n();
  const [preview, setPreview] = useState<Preview | null>(null);
  const [vaults, setVaults] = useState<ObsidianVault[]>([]);
  const [vaultId, setVaultId] = useState("");
  const [error, setError] = useState("");
  const [vaultError, setVaultError] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState<ObsidianArchive | null>(null);
  const [reload, setReload] = useState(0);
  const [includeDiscussion, setIncludeDiscussion] = useState(true);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setPreview(null); setError(""); setVaultError(""); setSaved(null);
    void Promise.all([
      researchRequest<Preview>(`/api/research/papers/export?id=${encodeURIComponent(paper.id)}&discussion=${includeDiscussion}`, { signal: controller.signal })
        .then(setPreview).catch((error) => { if (!controller.signal.aborted) setError(error.message); }),
      researchRequest<{ vaults: ObsidianVault[] }>("/api/robin/obsidian", { signal: controller.signal })
        .then(({ vaults }) => { setVaults(vaults); setVaultId(vaults.length === 1 ? vaults[0].id : ""); })
        .catch((error) => { if (!controller.signal.aborted) setVaultError(error.message); }),
    ]).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [paper.id, reload, includeDiscussion]);
  async function save() {
    if (!preview || !vaultId || busy) return;
    setBusy(true); setError("");
    try {
      const result = await researchRequest<{ archive: ObsidianArchive; paper: Paper }>("/api/research/papers/export", researchJson("POST", { id: paper.id, revision: preview.revision, vaultId, confirmed: true, includeDiscussion }));
      setSaved(result.archive); onChange(result.paper);
    } catch (error) { setError(error instanceof Error ? error.message : t("papers.error")); }
    finally { setBusy(false); }
  }
  function download() {
    if (!preview) return;
    const url = URL.createObjectURL(new Blob([preview.content], { type: "text/markdown;charset=utf-8" }));
    const link = document.createElement("a"); link.href = url;
    link.download = `${preview.title.replace(/[<>:"/\\|?*\u0000-\u001f]/g, "-").slice(0, 100) || "paper"}.md`;
    document.body.append(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  const vault = vaults.find((item) => item.id === vaultId);
  const latest = saved ?? paper.exports.map((item) => item.archive).filter((item): item is ObsidianArchive => !!item).at(-1);
  return <>
    <h3 className="pi-section-title">{t("papers.preview")}</h3>
    <p className={s.searchHint}>{t("papers.exportHint")}</p>
    <label className={s.actions} style={{ marginTop: 14, fontSize: 13 }}><input type="checkbox" checked={includeDiscussion} disabled={busy || loading} onChange={(event) => setIncludeDiscussion(event.target.checked)} />{t("papers.includeDiscussion")}</label>
    {loading && <p role="status" className={s.status}>{t("papers.loading")}</p>}
    {error && <p role="alert" className={s.error}>{error}</p>}
    {vaultError && <p role="alert" className={s.error}>{vaultError}</p>}
    {!loading && !vaults.length && <p className={s.notice}>{t("papers.noVault")}</p>}
    <button className={s.button} disabled={loading || busy} onClick={() => setReload((value) => value + 1)}>{t("papers.retry")}</button>
    {!!vaults.length && <label className={s.field} style={{ marginTop: 16 }}>{t("papers.vault")}<select aria-label={t("papers.vault")} disabled={busy} value={vaultId} onChange={(event) => { setVaultId(event.target.value); setSaved(null); }}><option value="">{t("papers.chooseVault")}</option>{vaults.map((item) => <option key={item.id} value={item.id}>{item.name} — {item.path}</option>)}</select></label>}
    {vault && <p className={s.searchHint}>{t("papers.destination", { path: vault.path })}</p>}
    {preview && <><pre className={s.preview} tabIndex={0} aria-label={t("papers.preview")}>{preview.content}</pre><div className={s.actions}>
      <button className={`${s.button} ${s.primary}`} disabled={busy || !vault || loading} onClick={() => void save()}>{t(busy ? "papers.exporting" : "papers.confirm")}</button>
      <button className={s.button} onClick={download}>{t("papers.download")}</button>
    </div></>}
    {saved && <p role="status" className={s.status}>{t("papers.exportSaved")} · {saved.relativePath}</p>}
    {latest && <p className={s.searchHint}><a href={latest.url}>{t("papers.openArchive")}</a><br />{latest.relativePath}</p>}
    <p className={s.searchHint}>{t("papers.localVault")}</p>
  </>;
}
