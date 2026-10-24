"use client";

import { useEffect, useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import { researchRequest } from "./research-client";
import s from "./ResearchWorkspace.module.css";

/** Original PDF pages rendered by Poppler, including on phones without a usable embedded PDF viewer. */
export function PaperPdf({ paperId, onUpload, disabled }: { paperId: string; onUpload: () => void; disabled: boolean }) {
  const { t } = useI18n();
  const [pdf, setPdf] = useState<{ pages: number; hash: string } | null>(null);
  const [page, setPage] = useState(1);
  const [zoom, setZoom] = useState(100);
  const [reload, setReload] = useState(0);
  const [error, setError] = useState("");
  const [imageError, setImageError] = useState(false);
  const [loadingImage, setLoadingImage] = useState(true);
  const url = `/api/research/papers/pdf?id=${encodeURIComponent(paperId)}`;
  useEffect(() => {
    const controller = new AbortController();
    setPdf(null); setError(""); setImageError(false); setLoadingImage(true);
    void researchRequest<{ pages: number; hash: string }>(url, { signal: controller.signal })
      .then((result) => { if (!controller.signal.aborted) { setPdf(result); setPage((current) => Math.min(current, result.pages)); } })
      .catch((failure) => { if (!controller.signal.aborted) setError(failure.message); });
    return () => controller.abort();
  }, [url, reload]);
  function changePage(next: number) { setPage(next); setLoadingImage(true); setImageError(false); }
  const src = pdf ? `${url}&hash=${pdf.hash}&page=${page}&retry=${reload}` : "";
  return <section aria-label={t("rw.pdf.original")}>
    <p className={s.marginHint}>{t("rw.pdf.hint")}</p>
    {pdf && <div className={s.pdfToolbar}>
      <button type="button" className={s.button} disabled={page <= 1} onClick={() => changePage(page - 1)}>{t("rw.pdf.previous")}</button>
      <select aria-label={t("rw.paper.jump")} value={page} onChange={(event) => changePage(Number(event.target.value))}>
        {Array.from({ length: pdf.pages }, (_, i) => <option key={i + 1} value={i + 1}>{t("rw.paper.page", { page: i + 1 })} / {pdf.pages}</option>)}
      </select>
      <button type="button" className={s.button} disabled={page >= pdf.pages} onClick={() => changePage(page + 1)}>{t("rw.pdf.next")}</button>
      <select aria-label={t("rw.pdf.zoom")} value={zoom} onChange={(event) => setZoom(Number(event.target.value))}>
        {[100, 150, 200, 250].map((value) => <option key={value} value={value}>{value === 100 ? t("rw.pdf.fit") : `${value}%`}</option>)}
      </select>
      <a className={s.textButton} href={`${url}&hash=${pdf.hash}&download=1`}>{t("rw.pdf.download")}</a>
    </div>}
    {(error || imageError) ? <div role="alert" className={s.error}>
      <p>{error || t("rw.pdf.failed")}</p>
      <div className={s.actions}>
        <button type="button" className={s.button} onClick={() => setReload((value) => value + 1)}>{t("rw.retry")}</button>
        <button type="button" className={s.button} disabled={disabled} onClick={onUpload}>{t("rw.uploadPdf")}</button>
      </div>
    </div> : <>
      {(!pdf || loadingImage) && <p role="status" className={s.status}>{t("rw.loading")}</p>}
      {pdf && <div className={s.pdfViewport} tabIndex={0} aria-label={t("rw.pdf.original")}>
        {/* Plain images preserve PDF layout on iOS too; only the selected page is downloaded/rendered. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img key={src} src={src} alt={t("rw.pdf.page", { page })} style={{ width: `${zoom}%` }}
          onLoad={() => setLoadingImage(false)} onError={() => { setLoadingImage(false); setImageError(true); }} />
      </div>}
    </>}
  </section>;
}
