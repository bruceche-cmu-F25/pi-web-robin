"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useI18n } from "@/hooks/useI18n";
import { useIsSplitLayout } from "@/hooks/useIsMobile";
import { AgentPanel } from "./AgentPanel";
import { PaneDivider } from "./PaneDivider";
import { ProductGlyph } from "./ProductGlyph";
import styles from "./ProductWorkspace.module.css";

const WIDTH_KEY = "pi-product-agent-width";
const MIN_WIDTH = 280;
const MAX_WIDTH = 520;
const PREFERRED_WIDTH = 340;
type Scope = { ideaId?: string; name?: string; validation?: boolean };
type Proposal = { id: string; ideaId: string; text: string };
interface AgentHandle {
  ask: (options?: { ideaId?: string; brief?: string }) => void;
  /** Context changes never dispatch a turn. Each idea retains its own mounted panel. */
  select: (scope: Scope) => void;
  partnerHost: HTMLDivElement | null;
  proposal: Proposal | null;
  clearProposal: (id: string) => void;
}
const AgentContext = createContext<AgentHandle>({ ask: () => {}, select: () => {}, partnerHost: null, proposal: null, clearProposal: () => {} });
export function useProductAgent(): AgentHandle { return useContext(AgentContext); }
const PRODUCT_TOOL_KEYS: Record<string, string> = { product_list: "product.tool.list", product_get: "product.tool.get", product_add_link: "product.tool.link" };

export function ProductIncubatorShell({ children }: { children: ReactNode }) {
  const { locale } = useI18n();
  const zh = locale.startsWith("zh");
  const split = useIsSplitLayout();
  const [agentOpen, setAgentOpen] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [scope, setScope] = useState<Scope>({});
  const [contexts, setContexts] = useState<string[]>([""]);
  const [pending, setPending] = useState<Record<string, { id: string; text: string }>>({});
  const [proposal, setProposal] = useState<Proposal | null>(null);
  const [partnerHost, setPartnerHost] = useState<HTMLDivElement | null>(null);
  const [agentWidth, setAgentWidth] = useState(PREFERRED_WIDTH);
  const latestWidth = useRef(PREFERRED_WIDTH);
  const toggleRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    try {
      const stored = Number(window.localStorage.getItem(WIDTH_KEY));
      if (Number.isFinite(stored) && stored >= MIN_WIDTH && stored <= MAX_WIDTH) { latestWidth.current = stored; setAgentWidth(stored); }
    } catch { /* Resizing still works when storage is unavailable. */ }
  }, []);
  const select = useCallback((next: Scope) => {
    setScope(current => current.ideaId === next.ideaId && current.name === next.name && current.validation === next.validation ? current : next);
    const key = next.ideaId ?? "";
    setContexts(current => current.includes(key) ? current : [...current, key]);
  }, []);
  const ask = useCallback(({ ideaId, brief }: { ideaId?: string; brief?: string } = {}) => {
    setScope(current => ({ ideaId, name: current.ideaId === ideaId ? current.name : undefined }));
    setContexts(current => current.includes(ideaId ?? "") ? current : [...current, ideaId ?? ""]);
    setAgentOpen(true); setMobileOpen(true);
    if (brief) setPending(current => ({ ...current, [ideaId ?? ""]: { id: crypto.randomUUID(), text: brief } }));
  }, []);
  const clearProposal = useCallback((id: string) => setProposal(current => current?.id === id ? null : current), []);
  const handle = useMemo(() => ({ ask, select, partnerHost, proposal, clearProposal }), [ask, select, partnerHost, proposal, clearProposal]);
  const resizeAgent = (requested: number) => {
    const next = Math.min(Math.max(requested, MIN_WIDTH), Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, window.innerWidth - 620)));
    latestWidth.current = next; setAgentWidth(next);
  };
  const commitWidth = () => { try { window.localStorage.setItem(WIDTH_KEY, String(latestWidth.current)); } catch { /* Optional browser preference. */ } };
  const close = () => { setAgentOpen(false); setMobileOpen(false); toggleRef.current?.focus(); };
  const visible = split ? agentOpen : mobileOpen;

  return <AgentContext.Provider value={handle}>
    <div className={`robin-page robin-dashboard robin-workspace-ground ${styles.labShell}`} data-mobile-partner={mobileOpen}>
      <header className={`robin-workspace-ground ${styles.shellHeader}`}><div className={styles.shellFrame}>
        <div className={styles.brandMark} aria-hidden="true"><ProductGlyph name="map" /></div>
        <div className={styles.labBrand}><h1 className={styles.shellTitle}>{zh ? "产品实验室" : "Product lab"}</h1><span>PRODUCT LAB / {zh ? "从想法到证据" : "FROM IDEA TO EVIDENCE"}</span></div>
        <button ref={toggleRef} type="button" onClick={() => { if (split) setAgentOpen(!agentOpen); else setMobileOpen(!mobileOpen); }} className="ui-action pi-bracket" aria-label={visible ? (zh ? "收起伙伴" : "Hide partner") : (zh ? "Brainstorm 伙伴" : "Brainstorm partner")} aria-expanded={visible} aria-controls="product-partner">
          {visible ? (zh ? "收起伙伴" : "Hide partner") : split ? (zh ? "Brainstorm 伙伴" : "Brainstorm partner") : (zh ? "伙伴" : "Partner")}
        </button>
      </div></header>
      <div className={styles.labBody}>
        <div className={styles.labWork}>{children}</div>
        {visible && split && <PaneDivider edge="right" label={zh ? "调整伙伴宽度" : "Resize partner"} title={zh ? "双击或 Enter 重置" : "Double-click or Enter to reset"} width={agentWidth} min={MIN_WIDTH} max={MAX_WIDTH} onResize={resizeAgent} onCommit={commitWidth} onReset={() => { resizeAgent(PREFERRED_WIDTH); commitWidth(); }} />}
        <aside id="product-partner" aria-label={zh ? "Brainstorm 伙伴" : "Brainstorm partner"} className={`robin-workspace-ground ${styles.labPartner}`} hidden={!visible} style={{ width: split ? agentWidth : undefined }}>
          <div className={styles.partnerContext}><strong>{scope.name || (zh ? "还没成形的想法" : "An idea taking shape")}</strong><p>{scope.validation ? (zh ? "草案不等于批准" : "A draft is not approval") : (zh ? "建议由你确认，不自动推进阶段。" : "You decide what to keep; stages never advance automatically.")}</p></div>
          <div ref={setPartnerHost} className={styles.partnerHost} hidden={!scope.validation} />
          {contexts.map(key => <div key={key} className={styles.partnerChat} hidden={Boolean(scope.validation) || key !== (scope.ideaId ?? "")}>
            <AgentPanel mode="product" endpoint="/api/robin/product-assistant" requestBody={key ? { productId: key } : {}} transcriptKey={`product-lab:${key || "incubator"}`}
              titleKey="product.agent.brainstorm" placeholderKey={key ? "product.agent.placeholder" : "product.agent.incubatorPlaceholder"} restartHintKey="product.agent.restartHint" emptyHintKey="product.agent.brainstormHint" toolKeys={PRODUCT_TOOL_KEYS}
              pending={pending[key]} disabled={!visible || Boolean(scope.validation) || key !== (scope.ideaId ?? "")} onClose={close}
              replyAction={key ? { labelKey: "product.agent.adopt", onReply: text => { setProposal({ id: crypto.randomUUID(), ideaId: key, text }); setMobileOpen(false); } } : undefined} />
          </div>)}
        </aside>
      </div>
    </div>
  </AgentContext.Provider>;
}
