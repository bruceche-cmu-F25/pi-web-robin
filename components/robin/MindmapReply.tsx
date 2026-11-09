"use client";

import { memo } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useI18n } from "@/hooks/useI18n";
import { mindmapUrl } from "@/extension/robin/mindmap";
import { splitAutolinkLiteralsAtCjkPunctuation } from "@/lib/markdown";
import styles from "./NoteMindmap.module.css";

const splitCjk = () => (tree: Parameters<typeof splitAutolinkLiteralsAtCjkPunctuation>[0], file: { value?: unknown }) => {
  splitAutolinkLiteralsAtCjkPunctuation(tree, typeof file.value === "string" ? file.value : "");
};
const plugins = [remarkGfm, splitCjk];
const elements = ["h1", "h2", "h3", "h4", "h5", "h6", "p", "a", "strong", "em", "del", "ul", "ol", "li", "blockquote", "pre", "code", "br", "hr", "table", "thead", "tbody", "tr", "th", "td"];
const safeUrl = (value: string) => {
  if (!/^https?:\/\//i.test(value)) return "";
  try { return mindmapUrl(value); } catch { return ""; }
};

/** Explanations and resource prose: no HTML, remote images, previews or local-file handlers. */
export const MindmapReply = memo(function MindmapReply({ text }: { text: string }) {
  const { t } = useI18n();
  return <div className={styles.reply}>
    <ReactMarkdown remarkPlugins={plugins} skipHtml allowedElements={elements} unwrapDisallowed urlTransform={safeUrl}
      components={{
        table: ({ children }) => <div className={styles.replyTable} role="region" aria-label={t("mindmap.markdownTable")} tabIndex={0}><table>{children}</table></div>,
        pre: ({ children }) => <pre tabIndex={0} role="region" aria-label={t("mindmap.markdownCode")}>{children}</pre>,
        a: ({ href, children }) => href
          ? <a href={href} target="_blank" rel="noopener noreferrer" title={`${href} · ${t("mindmap.newTab")}`}>{children}<span className={styles.srOnly}> · {t("mindmap.newTab")}</span></a>
          : <span>{children}</span>,
      }}>{text}</ReactMarkdown>
  </div>;
});
