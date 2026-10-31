"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useI18n } from "@/hooks/useI18n";
import { localDate } from "@/extension/robin/dates";
import { PLAYBOOK, PLAYBOOK_STEPS, nextStep, playbookStep, type PlaybookStep, type StepId } from "@/extension/robin/product-playbook";
import { ideaAttention } from "@/extension/robin/product-shape";
import type { Idea, IdeaLink, ProductCapture, ProductLibraryResource } from "@/extension/robin/product-domain";
// The chat input already downscales before base64, which matters: a
// screenshot pasted straight in is several megabytes of JSON otherwise.
import { compressImageFile } from "@/components/ChatInput";
import { useProductAgent } from "./ProductIncubatorShell";
import { ProductResourceShelf } from "./ProductResourceShelf";
import { ProductResearch } from "./ProductResearch";
import { ProductLaunchMap } from "./ProductLaunchMap";
import { ProductExperiments } from "./ProductExperiments";
import { ProductGlyph } from "./ProductGlyph";
import { productCopy, researchBrief, type ProductCopy } from "./product-copy";
import { categoryChip, stepSurface } from "./productSurface";
import { usePolledResource } from "./usePolledResource";
import { useBoardNavigation } from "./useBoardNavigation";
import { SaveStatus } from "./SaveStatus";
import { useIdeaText } from "./useIdeaText";
import { TextRecoveryNotice, TextRecoveryWarning } from "./TextRecoveryNotice";
import styles from "./ProductIdeas.module.css";

interface IdeasResponse {
  ideas: Idea[];
  captures: ProductCapture[];
}

type IdeaFilter = "active" | "attention" | "parked" | StepId;
type WorkspaceView = "discover" | "map" | "ideas" | "inbox" | "experiments" | "evidence" | "outreach";
function workspaceView(params: { get: (key: string) => string | null }): WorkspaceView {
  const view = params.get("view");
  if (view === "map" || view === "ideas" || view === "discover" || view === "inbox" || view === "experiments" || view === "evidence" || view === "outreach") return view;
  return "ideas";
}

function ideaFilter(value: string | null): IdeaFilter {
  if (value === "attention" || value === "parked" || PLAYBOOK_STEPS.includes(value as StepId)) return value as IdeaFilter;
  return "active";
}

interface Suggestion {
  kind: "idea" | "resource" | "link" | "note";
  title: string;
  summary: string;
  confidence: "low" | "medium" | "high";
  reason: string;
  url?: string;
}

async function jsonRequest<T>(url: string, method: string, body: unknown): Promise<T> {
  const response = await fetch(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const parsed = await response.json().catch(() => null) as (T & { error?: string }) | null;
  if (!response.ok || !parsed) throw new Error(parsed?.error ?? `Request failed (${response.status})`);
  return parsed;
}

/** Evidence first; research, the reference map and the user's notes stay distinct. */
export function ProductIdeas() {
  const { locale } = useI18n();
  const searchParams = useSearchParams();
  const copy = productCopy(locale);
  const zh = locale.startsWith("zh");
  const { data, error, refresh, updateData } = usePolledResource<IdeasResponse>("/api/robin/products", 30_000);
  // One owner for the library: both the current step and the full shelf read
  // this snapshot, and shelf edits refresh it here instead of starting a
  // second poll for the same thirty-four rows.
  const { data: library, error: libraryError, refresh: refreshLibrary } = usePolledResource<{ resources: ProductLibraryResource[] }>("/api/robin/product-library", 60_000);
  const [openId, setOpenId] = useState<string | null>(() => searchParams.get("idea") || null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [filter, setFilter] = useState<IdeaFilter>(() => ideaFilter(searchParams.get("stage")));
  const [view, setView] = useState<WorkspaceView>(() => workspaceView(searchParams));
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [railOpen, setRailOpen] = useState(false);
  const railToggle = useRef<HTMLButtonElement>(null);
  const [visitedValidation, setVisitedValidation] = useState<string[]>([]);
  const { select: selectPartner, proposal } = useProductAgent();
  const openedProposal = useRef<string | null>(null);
  const [captureFocus, setCaptureFocus] = useState(0);
  const captureName = useRef<HTMLInputElement>(null);
  const { scrollRef, updateView } = useBoardNavigation("/product", searchParams.toString(), Boolean(data));

  useEffect(() => {
    const stage = ideaFilter(searchParams.get("stage"));
    setFilter(stage);
    setView(workspaceView(searchParams));
    setOpenId(searchParams.get("idea") || null);
  }, [searchParams]);

  const chooseView = (next: WorkspaceView) => {
    setView(next); setRailOpen(false);
    updateView({ view: next });
    scrollRef.current?.scrollTo({ top: 0 });
    scrollRef.current?.focus({ preventScroll: true });
  };

  const startCapture = () => {
    setView("inbox"); setOpenId(null); setRailOpen(false);
    updateView({ view: "inbox", idea: null, experiment: null });
    setCaptureFocus((count) => count + 1);
  };

  const chooseFilter = (next: IdeaFilter) => {
    setFilter(next);
    updateView({ stage: next === "active" ? null : next });
  };

  const chooseIdea = (id: string | null, mode: "push" | "replace" = "push") => {
    setOpenId(id);
    updateView({ idea: id, experiment: null }, mode);
  };
  const openProject = (id: string | null) => {
    setOpenId(id); setView("ideas"); setRailOpen(false);
    if (!id) setFilter("active");
    updateView({ idea: id, view: "ideas", experiment: null, ...(!id ? { stage: null } : {}) });
    scrollRef.current?.scrollTo({ top: 0 });
    scrollRef.current?.focus({ preventScroll: true });
  };

  const ideas = useMemo(() => data?.ideas ?? [], [data?.ideas]);
  const selected = ideas.find(idea => idea.id === openId);
  const validationActive = !!selected && (view === "experiments" || view === "evidence");
  const partnerIdea = view === "inbox" ? undefined : selected;
  useEffect(() => {
    selectPartner({ ideaId: partnerIdea?.id, name: partnerIdea?.name, validation: validationActive });
  }, [partnerIdea?.id, partnerIdea?.name, validationActive, selectPartner]);
  useEffect(() => {
    if (!proposal || openedProposal.current === proposal.id) return;
    openedProposal.current = proposal.id;
    setOpenId(proposal.ideaId); setView("ideas"); setRailOpen(false);
    updateView({ idea: proposal.ideaId, view: "ideas", experiment: null });
  }, [proposal, updateView]);
  useEffect(() => {
    if (validationActive && selected) setVisitedValidation(current => current.includes(selected.id) ? current : [...current, selected.id]);
  }, [validationActive, selected]);
  const today = localDate();
  const parked = useMemo(() => ideas.filter((idea) => idea.parked).length, [ideas]);
  // The decision queue uses the same attention rules as each idea card.
  const needsAttention = useMemo(
    () => ideas.filter((idea) => ideaAttention(idea, today) !== null).length,
    [ideas, today],
  );

  const selectedStep = PLAYBOOK.find((step) => step.id === filter);
  const showViews = !!data && (needsAttention > 0 || parked > 0 || filter === "attention" || filter === "parked" || !!selectedStep);
  const visibleIds = new Set(ideas.filter((idea) => {
    if (filter === "parked") return !!idea.parked;
    if (filter === "attention") return ideaAttention(idea, today) !== null;
    return !idea.parked && (filter === "active" || idea.step === filter);
  }).map((idea) => idea.id));

  const act = async <T,>(run: () => Promise<T>): Promise<T | null> => {
    setActionError(null);
    try {
      const result = await run();
      // Preserve the write receipt even if the follow-up GET is offline.
      const saved = (result as { idea?: Idea } | null)?.idea;
      if (saved) updateData((current) => current && ({ ...current,
        ideas: current.ideas.map((idea) => idea.id === saved.id ? saved : idea),
      }));
      await refresh();
      return result;
    } catch (caught) {
      setActionError(caught instanceof Error ? caught.message : String(caught));
      return null;
    }
  };

  return (
    <div className={styles.page}>
      <div className={styles.mobileTools}><button ref={railToggle} type="button" className="ui-action" aria-expanded={railOpen} aria-controls="product-lab-navigation" onClick={() => setRailOpen(!railOpen)}>{zh ? "项目目录" : "Projects"}</button><span>{view === "inbox" ? (zh ? "想法收件箱" : "Idea inbox") : view === "map" ? (zh ? "产品全景图" : "Product map") : view === "discover" ? (zh ? "机会研究" : "Opportunities") : selected?.name || (zh ? "实验室总览" : "Lab overview")}</span></div>
      <div className={styles.labLayout}>
        <nav id="product-lab-navigation" aria-label={zh ? "产品工作区" : "Product workspace"} className={`robin-workspace-rail ${styles.pageNav}`} data-open={railOpen} onKeyDown={event => {
          if (event.key === "Escape" && railOpen && !event.defaultPrevented) {
            event.stopPropagation(); setRailOpen(false); railToggle.current?.focus({ preventScroll: true });
          }
        }}>
          <div className={styles.viewLinks}>
            <button type="button" className="ui-action" aria-current={view === "ideas" && !selected ? "page" : undefined} onClick={() => { setFilter("active"); openProject(null); }}><ProductGlyph name="map" />{zh ? "实验室总览" : "Lab overview"}</button>
            <button type="button" className="ui-action" aria-current={view === "inbox" ? "page" : undefined} onClick={() => chooseView("inbox")}><ProductGlyph name="idea" />{zh ? "想法收件箱" : "Idea inbox"}<small>{data?.captures.length ?? ""}</small></button>
          </div>
          <div className={styles.railGroup}><p className="pi-eyebrow">{zh ? "正在探索" : "EXPLORING"}</p>
            {ideas.filter(idea => !idea.parked).map(idea => <button type="button" key={idea.id} className="ui-action" aria-current={selected?.id === idea.id && !["map", "discover", "inbox"].includes(view) ? "page" : undefined} onClick={() => openProject(idea.id)}><span className={styles.projectDot} aria-hidden="true" /><span>{idea.name}</span></button>)}
            {!ideas.length && data && <p className={styles.railHint}>{zh ? "还没有项目，先留下一个念头。" : "Start with a thought, not a business plan."}</p>}
            <button type="button" className="ui-action" onClick={startCapture}>＋ {copy.directIdea}</button>
          </div>
          <div className={styles.railGroup}><details><summary>{zh ? "暂存想法" : "Parked ideas"} · {parked}</summary>{ideas.filter(idea => idea.parked).map(idea => <button type="button" key={idea.id} className="ui-action" onClick={() => openProject(idea.id)}>{idea.name}</button>)}</details></div>
          <div className={styles.railGroup}><p className="pi-eyebrow">{zh ? "参考资料" : "REFERENCE"}</p>
            {(["discover", "map"] as const).map(item => <button key={item} type="button" className="ui-action" aria-pressed={view === item} onClick={() => chooseView(item)}>{item === "discover" ? (zh ? "机会研究" : "Opportunities") : (zh ? "产品全景图" : "Product map")}</button>)}
          </div>
          <div className={styles.toolLinks}><a href="/product/validation" className="ui-action">{zh ? "全部市场验证 ↗" : "All market validation ↗"}</a><a href="/product/jarvis" className="ui-action">{zh ? "原有 Outreach ↗" : "Existing Outreach ↗"}</a><p>{zh ? "原有联系人与发送规则保持不变。" : "Existing contacts and sending rules are unchanged."}</p></div>
        </nav>
        <main ref={scrollRef} tabIndex={-1} className={styles.readingPane}>
        <div className={styles.content}>
          {selected && !["map", "discover", "inbox"].includes(view) && <>
            <div className={styles.breadcrumb}><button type="button" className="ui-action" onClick={() => openProject(null)}>{zh ? "实验室" : "Lab"}</button><span>/</span><span>{selected.name}</span>{selected.parked && <span>{copy.parked}</span>}</div>
            <nav className={`robin-workspace-tabs robin-workspace-view-switch ${styles.projectTabs}`} aria-label={zh ? "项目视图" : "Project views"}>{(["ideas", "experiments", "outreach", "evidence"] as const).map(tab => <button type="button" key={tab} className="ui-action" aria-current={view === tab ? "page" : undefined} onClick={() => chooseView(tab)}>{({ ideas: zh ? "概览" : "Overview", experiments: zh ? "实验" : "Experiments", outreach: "Outreach", evidence: zh ? "证据与决定" : "Evidence & decisions" })[tab]}</button>)}</nav>
          </>}
          {data && openId && !selected && <p role="alert">{zh ? "这个想法已不存在。请选择其他项目。" : "This idea is unavailable. Choose another project."}</p>}
        <div id="product-view-discover" hidden={view !== "discover"}>
          <ProductResearch zh={zh} active={view === "discover"} onCapture={startCapture} onRefresh={refresh} onCreated={async (idea) => {
            await refresh();
            setView("ideas"); setFilter(idea.parked ? "parked" : "active"); setOpenId(idea.id);
            updateView({ view: "ideas", stage: idea.parked ? "parked" : null, idea: idea.id });
          }} />
        </div>
        <div id="product-view-map" hidden={view !== "map"}>
          <ProductLaunchMap zh={zh} ideas={ideas} ideaId={openId} onChoose={chooseIdea} onRefresh={refresh} />
        </div>

        {error || libraryError || actionError ? (
          <p role="alert" className="pi-panel p-3 text-sm" style={{ color: "var(--danger)" }}>{error ?? libraryError ?? actionError}</p>
        ) : null}

        <div id="product-view-ideas" hidden={view !== "ideas"} className={styles.workbench}>
          <header className={styles.workbenchHeader} hidden={!!selected}>
            <div>
              <span className="pi-eyebrow">{zh ? "少一点堆积，多一个验证" : "LESS COLLECTING. ONE MORE TEST."}</span>
              <h2 id="product-workbench">{zh ? "少一点猜测，多一点证据。" : "Fewer guesses. More evidence."}</h2>
              <p>{zh ? "留住想法，找到证据，再决定值不值得继续。" : "Capture an idea, find evidence, then decide whether to keep going."}</p>
            </div>
            <button type="button" onClick={startCapture} className={`ui-action ui-action--primary ${styles.captureShortcut}`}><span aria-hidden="true">＋</span>{copy.directIdea}</button>
          </header>
          <section className="flex min-w-0 flex-col gap-4" aria-labelledby="product-workbench">
            <div className={styles.listToolbar} hidden={!!selected}>
              <h3>{filter === "parked" ? copy.parked : filter === "attention" ? copy.attention : zh ? "正在推进" : "Active ideas"}<span>{data ? visibleIds.size : "—"}</span></h3>
              <select aria-label={zh ? "按项目阶段筛选" : "Filter by project stage"} value={selectedStep?.id ?? "active"} onChange={(event) => chooseFilter(event.target.value as IdeaFilter)} className="pi-panel min-h-11 px-2 text-xs">
                <option value="active">{zh ? "全部阶段" : "All stages"}</option>
                {PLAYBOOK.map((step) => <option key={step.id} value={step.id}>{step.name[zh ? "zh" : "en"]}</option>)}
              </select>
            </div>
            {/* These views filter personal work only, never the reference map. */}
            {showViews && !selected ? (
              <div className={styles.filters} role="group" aria-label={copy.ideas}>
                {([
                  ["active", copy.active, ideas.length - parked],
                  ["attention", copy.attention, needsAttention],
                  ["parked", copy.parked, parked],
                ] as const).filter(([value, , count]) => value === "active" || count > 0 || filter === value).map(([value, label, count]) => (
                  <button key={value} type="button" aria-pressed={filter === value} onClick={() => chooseFilter(value)} className="ui-action min-h-[44px] px-3 text-xs" data-selected={filter === value}>
                    {label} <span className="ml-1 tabular-nums">{count}</span>
                  </button>
                ))}
              </div>
            ) : null}

            {!data ? <p role="status" className="pi-panel p-6 text-sm">{error ? copy.error : copy.loading}</p> : null}
            {data && !selected && visibleIds.size === 0 ? (
              <div className={`${styles.empty} pi-card`}>
                <span className="pi-eyebrow">{selectedStep ? selectedStep.name[zh ? "zh" : "en"] : copy.ideas}</span>
                <h3 className="mt-3 text-lg">{ideas.length === 0 ? copy.noIdeas : copy.noMatches}</h3>
                <p className="mt-2 max-w-lg text-sm" style={{ color: "var(--text-muted)" }}>
                  {selectedStep ? selectedStep.does[0]?.[zh ? "zh" : "en"] : copy.noIdeasHint}
                </p>
                {filter !== "active" ? <button type="button" onClick={() => chooseFilter("active")} className="ui-action pi-bracket mt-4 min-h-[44px] text-xs">{copy.clearFilter}</button> : <button type="button" onClick={() => chooseView("discover")} className="ui-action pi-bracket mt-4 min-h-[44px] text-xs">{zh ? "看看机会研究" : "Explore opportunities"}</button>}
              </div>
            ) : null}
            {/* Keep filtered rows mounted: changing views must not discard drafts. */}
            <ul className="m-0 flex list-none flex-col gap-3 p-0" aria-label={copy.ideas}>
              {ideas.map((idea) => (
                <IdeaRow
                  key={idea.id}
                  idea={idea}
                  hidden={view !== "ideas" || (selected ? idea.id !== selected.id : !visibleIds.has(idea.id))}
                  copy={copy}
                  locale={locale}
                  today={today}
                  resources={library?.resources ?? []}
                  open={openId === idea.id}
                  onToggle={() => openProject(openId === idea.id ? null : idea.id)}
                  onAct={act}
                  onGone={() => chooseIdea(null, "replace")}
                  onPlan={() => {
                    setOpenId(idea.id);
                    setView("map");
                    updateView({ idea: idea.id, view: "map" });
                    scrollRef.current?.scrollTo({ top: 0 });
                  }}
                />
              ))}
            </ul>
          </section>

        </div>
        <div id="product-view-inbox" hidden={view !== "inbox"} className={styles.captureColumn} aria-label={zh ? "记录与下一步" : "Capture and next steps"}>
          <Capture
            nameRef={captureName}
            focusRequest={captureFocus}
            captures={data?.captures ?? []}
            ideas={ideas}
            copy={copy}
            locale={locale}
            onDone={async () => { await Promise.all([refresh(), refreshLibrary()]); }}
            onCreated={(idea) => {
              updateData(current => ({ ideas: [...(current?.ideas ?? []).filter(item => item.id !== idea.id), idea], captures: current?.captures ?? [] }));
              setFilter("active"); openProject(idea.id);
            }}
          />
          <section className={styles.nextSteps} aria-labelledby="product-next-steps">
            <h3 id="product-next-steps">{zh ? "接下来，做什么？" : "What comes next?"}</h3>
            <p>{zh ? "不确定有没有需求：打开想法，验证一个问题。已有证据：用全景图规划实现、收费与上线。" : "Unsure about demand? Open an idea and test one problem. Have evidence? Use the map to plan building, billing and launch."}</p>
            <p>{zh ? "验证由你确认标准与结论；不会自动推进想法，也不会发送外联。" : "You approve the criteria and verdict. Validation never advances an idea or sends outreach automatically."}</p>
          </section>
        </div>

        {ideas.filter(idea => visitedValidation.includes(idea.id)).map(idea => <div key={idea.id} hidden={!validationActive || idea.id !== selected?.id}>
          <ProductExperiments idea={idea} locale={locale} active={validationActive && idea.id === selected?.id} view={view === "evidence" ? "evidence" : "plan"} experimentId={idea.id === selected?.id ? searchParams.get("experiment") : null} onSelect={id => updateView({ experiment: id })} />
        </div>)}
        <section hidden={view !== "outreach"} className={styles.outreach}>
          <span className="pi-eyebrow">EXISTING WORKSPACE</span><h2>{zh ? "Outreach 保持原样" : "Outreach stays as it is"}</h2><p>{zh ? "原有联系人、审核／发送队列、发送记录与 LinkedIn Connect 继续在原工作区。当前尚未关联到这个产品，不显示虚构的外联数量。" : "Contacts, review/send queues, send history and LinkedIn Connect remain in the existing workspace. They are not yet linked to this product; no invented outreach counts."}</p>
          <a href="/outreach/research" target="_blank" rel="noopener noreferrer" aria-label={zh ? "打开原有 Outreach ↗" : "Open existing Outreach ↗"} className="ui-action pi-bracket">{zh ? "打开原有 Outreach ↗" : "Open existing Outreach ↗"}</a><p className={styles.railHint}>{zh ? "将在新标签页打开真实工作区；不会转移当前想法、初始化数据或发送消息。" : "Opens the real workspace in a new tab. No idea transfer, initialization or sending."}</p>
        </section>
        {!selected && (view === "experiments" || view === "evidence") && <p>{zh ? "先从目录选择一个想法。" : "Choose an idea from the project index first."}</p>}

        <section hidden={view !== "map"} className="border-t pt-5" style={{ borderColor: "var(--border)" }} aria-labelledby="product-toolkit">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 id="product-toolkit" className="pi-label">{copy.resources}</h2>
              <p className="mt-2 text-xs" style={{ color: "var(--text-muted)" }}>{copy.libraryHint}</p>
            </div>
            <button type="button" aria-expanded={libraryOpen} aria-controls="product-library" onClick={() => setLibraryOpen(!libraryOpen)} className="ui-action pi-bracket min-h-[44px] text-xs">
              {libraryOpen ? copy.hideResources : copy.browseResources}
              {library ? ` · ${library.resources.filter((item) => item.status !== "archived").length}` : ""}
            </button>
          </div>
          <div id="product-library" hidden={!libraryOpen} className="mt-4">
            <ProductResourceShelf
              locale={locale}
              resources={library?.resources ?? []}
              onRefresh={refreshLibrary}
            />
          </div>
        </section>
        </div>
        </main>
      </div>
    </div>
  );
}

/** Preview the next question; the idea's text module owns autosave and recovery. */
function IdeaRow({ idea, hidden, copy, locale, today, resources, open, onToggle, onAct, onGone, onPlan }: {
  idea: Idea;
  hidden: boolean;
  copy: ProductCopy;
  locale: string;
  today: string;
  resources: ProductLibraryResource[];
  open: boolean;
  onToggle: () => void;
  onAct: <T,>(run: () => Promise<T>) => Promise<T | null>;
  onGone: () => void;
  onPlan: () => void;
}) {
  const patchIdea = (patch: Record<string, unknown>) =>
    onAct(() => jsonRequest(`/api/robin/products/${encodeURIComponent(idea.id)}`, "PATCH", patch));
  const text = useIdeaText(idea, async patch => Boolean(await patchIdea(patch)));
  const { name, note } = text;
  const nameInput = useRef<HTMLInputElement>(null);
  const noteInput = useRef<HTMLTextAreaElement>(null);
  const [saving, setSaving] = useState(false);
  const busy = saving || text.removing;
  const surface = stepSurface(idea.step, idea.parked);
  const step = playbookStep(idea.step);
  const zh = locale.startsWith("zh");
  const agent = useProductAgent();
  const attention = ideaAttention(idea, today);
  const proposal = agent.proposal?.ideaId === idea.id ? agent.proposal : null;
  const [hasOpened, setHasOpened] = useState(open);
  useEffect(() => { if (open) setHasOpened(true); }, [open]);

  // Stage/bet/link writes remain separate from the editable text queue.
  const save = async (patch: Record<string, unknown>) => {
    setSaving(true);
    await patchIdea(patch);
    setSaving(false);
  };

  const firstLine = idea.note.split("\n").find((line) => line.trim()) ?? "";

  return (
    <li
      hidden={hidden}
      className={`pi-card ${styles.idea}`}
      data-open={open}
      style={{ borderLeft: open ? undefined : surface.spine }}
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 p-4">
        {open ? (
          // Open, the heading is the name field — one name on the card, not a
          // title with an input repeating it underneath.
          <div className="min-w-0 basis-full split:basis-auto split:flex-1">
            <input
              ref={nameInput}
              value={name}
              disabled={busy}
              onChange={(event) => text.edit("name", event.target.value)}
              onBlur={() => void text.save("name")}
              onKeyDown={(event) => {
                if (event.nativeEvent.isComposing) return;
                if (event.key === "Enter") event.currentTarget.blur();
                if (event.key === "Escape") text.discardName();
              }}
              aria-label={copy.ideaName}
              className={styles.titleInput}
            />
          </div>
        ) : (
          <button
            type="button"
            onClick={onToggle}
            aria-expanded={open}
            aria-controls={`product-notebook-${idea.id}`}
            className="ui-action flex min-h-[44px] min-w-0 basis-full flex-col items-start gap-2 text-left split:basis-auto split:flex-1"
          >
            <span className="text-lg font-semibold" style={{ color: "var(--text)", overflowWrap: "anywhere" }}>{name.trim() || idea.name}</span>
            {firstLine ? <span className="line-clamp-2 text-sm" style={{ color: "var(--text-muted)" }}>{firstLine}</span> : null}
          </button>
        )}

        {attention ? (
          <span className="pi-eyebrow shrink-0 whitespace-nowrap" style={{ color: "var(--warning)" }}>
            {attention === "overdue" ? copy.overdue : copy.stale}
          </span>
        ) : null}

        {idea.parked ? <span className="pi-eyebrow">{copy.parked}</span> : null}
        {/* Only worth saying on a closed card: open, the status sits under the notes. */}
        {text.state !== "saved" && !open ? <SaveStatus state={text.state} onRetry={() => void text.retry()} /> : null}

        <select
          value={idea.step}
          disabled={busy}
          aria-label={`${idea.name} — ${copy.step}`}
          onChange={(event) => void save({ step: event.target.value })}
          className="pi-panel min-h-[44px] min-w-0 flex-1 px-2 text-xs split:min-h-8 split:flex-none split:px-1"
          style={{ color: surface.ink }}
        >
          {PLAYBOOK.map((item) => <option key={item.id} value={item.id}>{item.name[zh ? "zh" : "en"]}</option>)}
        </select>

      </div>

      {!open ? (
        <div className="mx-4 border-t py-3" style={{ borderColor: "var(--border)" }}>
          <p className="pi-eyebrow">{idea.bet && !idea.bet.settled ? copy.bet : copy.nextAction}</p>
          <p className="mt-1 line-clamp-2 text-sm" style={{ color: "var(--text)" }}>
            {idea.bet && !idea.bet.settled ? idea.bet.claim : step.does[0]?.[zh ? "zh" : "en"]}
          </p>
          {idea.bet?.by && !idea.bet.settled ? <p className="pi-eyebrow mt-2">{copy.betBy} · {idea.bet.by}</p> : null}
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 pb-3">
        <a href={`/product/validation?idea=${encodeURIComponent(idea.id)}`} className="ui-action pi-bracket min-h-11 content-center text-xs" data-state="accent">{zh ? "验证这个想法" : "Validate this idea"}</a>
        <button type="button" onClick={onPlan} className="ui-action min-h-11 text-xs">{zh ? "打开产品全景图" : "Open product map"}</button>
        <span className="pi-eyebrow">{copy.links} · {idea.links.length}</span>
        <span className="pi-eyebrow">{copy.updated} {new Date(idea.updatedAt).toLocaleDateString(locale, { month: "short", day: "numeric" })}</span>
        <button type="button" onClick={onToggle} aria-expanded={open} aria-controls={`product-notebook-${idea.id}`} className="ui-action pi-bracket ml-auto min-h-[44px] text-xs" data-state={open ? undefined : "accent"}>
          {open ? copy.closeIdea : copy.openIdea}
        </button>
      </div>

      {text.backupFailed ? <TextRecoveryWarning /> : null}
      {open || hasOpened ? <div hidden={!open} id={`product-notebook-${idea.id}`} className="flex flex-col gap-4 border-t p-4" style={{ borderColor: "var(--border)" }}>
          <TextRecoveryNotice scope="product" id={idea.id} writer={text.writer} disabled={busy}
            onRestore={(fields) => {
              let backedUp = true;
              if (typeof fields.name === "string") {
                backedUp = text.edit("name", fields.name);
                // Name keeps its normal blur-to-save behavior after restoration.
                nameInput.current?.focus();
              }
              if (typeof fields.note === "string") backedUp = text.edit("note", fields.note) && backedUp;
              return backedUp;
            }} />
          <section className={styles.question}>
            <span className="pi-eyebrow">{zh ? "本轮问题 / QUESTION FIRST" : "QUESTION FIRST"}</span>
            <h3>{idea.bet && !idea.bet.settled ? idea.bet.claim : step.question[zh ? "zh" : "en"]}</h3>
            <p>{zh ? "先确认问题，再讨论该做什么。" : "Understand the problem before deciding what to build."}</p>
            <button type="button" className="ui-action pi-bracket" onClick={() => agent.ask({ ideaId: idea.id, brief: zh ? "请挑战这个想法的关键假设，找出最需要验证的一个问题。先讨论，不联网研究，也不保存内容。" : "Challenge this idea's key assumptions and identify the one question most worth testing. Discuss first; do not research the web or save anything." })}>{zh ? "和伙伴推敲 ↗" : "Think it through ↗"}</button>
          </section>
          <label className="flex flex-col gap-2">
            <span className="pi-eyebrow">{copy.notebook}</span>
          <textarea
            ref={noteInput}
            value={note}
            disabled={busy}
            onChange={(event) => text.edit("note", event.target.value)}
            onBlur={() => void text.save("note")}
            aria-label={copy.note}
            placeholder={copy.notePlaceholder}
            rows={6}
            className="pi-panel w-full resize-y p-2 text-sm outline-none"
          />
          </label>
          <SaveStatus state={text.state} onRetry={() => void text.retry()} />

          <details className={styles.legacyTools}><summary>{zh ? "阶段参考与原有假设工具" : "Stage reference & existing hypothesis tools"}</summary>
            <StepCard idea={idea} step={step} copy={copy} zh={zh} busy={busy} resources={resources} onSave={save} onResearch={() => agent.ask({ ideaId: idea.id, brief: researchBrief({ name, note }, locale) })} />
            <Bet idea={idea} copy={copy} busy={busy} today={today} onSave={save} />
          </details>

          <IdeaLinks idea={idea} copy={copy} busy={busy} onAct={onAct} onSave={save} />

          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              disabled={busy}
              onClick={() => void save({ parked: !idea.parked })}
              className="ui-action min-h-[44px] px-2 text-xs split:min-h-0 split:px-0"
              style={{ color: "var(--text-dim)" }}
            >
              {idea.parked ? copy.unpark : copy.park}
            </button>
            <button
              type="button"
              disabled={busy}
              className="ui-action ml-auto min-h-[44px] px-2 text-xs disabled:opacity-40"
              style={{ color: "var(--danger)" }}
              onClick={async () => {
                if (!window.confirm(copy.deleteConfirm)) return;
                const removed = await text.remove(async () => Boolean(await onAct(() => jsonRequest(`/api/robin/products/${encodeURIComponent(idea.id)}`, "DELETE", undefined))));
                if (removed) onGone();
              }}
            >
              {copy.delete}
            </button>
          </div>
        </div> : null}
      {proposal && !hidden && open && <ProductProposalDialog key={proposal.id} text={proposal.text} name={name} zh={zh} busy={busy} onClose={() => { agent.clearProposal(proposal.id); noteInput.current?.focus(); }} onAppend={addition => text.edit("note", `${note}${note.trim() ? "\n\n" : ""}${addition}`)} />}
    </li>
  );
}

/** Seed the editable preview before opening the native dialog; reopening never reuses stale DOM text. */
function ProductProposalDialog({ text, name, zh, busy, onClose, onAppend }: { text: string; name: string; zh: boolean; busy: boolean; onClose: () => void; onAppend: (text: string) => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const [draft, setDraft] = useState(text);
  useEffect(() => { dialog.current?.showModal(); }, []);
  return <dialog ref={dialog} className={styles.proposalDialog} aria-labelledby={titleId} onClose={onClose}>
    <h2 id={titleId}>{zh ? "先看一眼，再采纳" : "Review before keeping"}</h2>
    <p>{zh ? `只追加到「${name}」的笔记，不覆盖原文、批准实验或推进阶段。` : `Append to “${name}” only. This never replaces notes, approves an experiment or advances a stage.`}</p>
    <label>{zh ? "准备加入的内容" : "Content to append"}<textarea aria-label={zh ? "准备加入的内容" : "Content to append"} value={draft} onChange={event => setDraft(event.target.value)} rows={8} /></label>
    <div className={styles.dialogActions}><button type="button" className="ui-action" onClick={() => dialog.current?.close()}>{zh ? "取消" : "Cancel"}</button><button type="button" disabled={!draft.trim() || busy} className="ui-action ui-action--primary" onClick={() => { onAppend(draft.trim()); dialog.current?.close(); }}>{zh ? "追加到笔记（自动保存）" : "Append to notes (autosave)"}</button></div>
  </dialog>;
}

/**
 * What this step is, what to do in it, and what to reach for.
 *
 * This is the thing the section was missing for its whole life. A six-column
 * board asked you to know the process and record your position in it; what was
 * wanted was to be told the process. So the step is not a label on a card, it
 * is a short page of instructions with the shelf for that bench beside it.
 *
 * The library's five categories were built for exactly this and then left
 * orphaned on a route of their own — a directory you had to think to visit.
 * Here they arrive when they are the right tool.
 *
 * "Done" is the only gate and it is not enforced: you can set any step from
 * the row above at any time. Advice that locks you out stops being advice.
 */
function StepCard({ idea, step, copy, zh, busy, resources, onSave, onResearch }: {
  idea: Idea;
  step: PlaybookStep;
  copy: ProductCopy;
  zh: boolean;
  busy: boolean;
  resources: ProductLibraryResource[];
  onSave: (patch: Record<string, unknown>) => Promise<void>;
  onResearch: () => void;
}) {
  const lang = zh ? "zh" : "en";
  const after = nextStep(step.id);
  const [guideOpen, setGuideOpen] = useState(false);
  const guideId = `product-step-guide-${idea.id}`;
  const shelf = resources
    .filter((item) => step.categories.includes(item.category) && item.status !== "archived")
    .sort((a, b) => Number(b.status === "using") - Number(a.status === "using") || a.name.localeCompare(b.name));
  const surface = stepSurface(idea.step, idea.parked);

  return (
    <section
      className="pi-panel flex flex-col gap-3 p-3"
      style={{ borderLeft: surface.spine }}
    >
      <header className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="pi-eyebrow tabular-nums" style={{ color: surface.ink }}>
          {PLAYBOOK_STEPS.indexOf(step.id) + 1}/{PLAYBOOK_STEPS.length} · {step.name[lang]}
        </span>
        {idea.parked ? <span className="pi-eyebrow">{copy.parkedNote}</span> : null}
        <button
          type="button"
          aria-expanded={guideOpen}
          aria-controls={guideId}
          onClick={() => setGuideOpen((current) => !current)}
          className="ui-action pi-bracket ml-auto min-h-[44px] px-2 text-xs split:min-h-0 split:px-0"
        >
          {guideOpen ? copy.hideGuide : copy.showGuide}
        </button>
      </header>

      <div>
        <p className="pi-eyebrow">{copy.nextAction}</p>
        <p className="mt-1 text-sm" style={{ color: "var(--text)" }}>{step.does[0]?.[lang]}</p>
      </div>

      {step.action === "research" ? (
        <button type="button" onClick={onResearch} className="ui-action pi-bracket min-h-[44px] self-start px-2 text-xs split:min-h-0 split:px-0" data-state="accent">
          {copy.research}
        </button>
      ) : null}

      <div className="flex flex-col items-start gap-2 border-t pt-3 split:flex-row split:items-baseline split:gap-x-3" style={{ borderColor: "var(--border)" }}>
        <span className="pi-eyebrow">{copy.whatDone}</span>
        <span className="w-full text-xs split:min-w-0 split:flex-1" style={{ color: "var(--text-muted)" }}>{step.done[lang]}</span>
        {after ? (
          <button
            type="button"
            disabled={busy}
            onClick={() => void onSave({ step: after })}
            className="ui-action pi-bracket min-h-[44px] shrink-0 px-2 text-xs split:min-h-0 split:px-0"
          >
            {copy.stepDone}
          </button>
        ) : null}
      </div>

      {guideOpen ? (
        <div id={guideId} className="flex flex-col gap-3 border-t pt-3" style={{ borderColor: "var(--border)" }}>
          <div>
            <p className="pi-eyebrow">{copy.whatFor}</p>
            <p className="mt-1 text-sm" style={{ color: "var(--text)" }}>{step.question[lang]}</p>
          </div>

          <div>
            <p className="pi-eyebrow">{copy.whatToDo}</p>
            <ol className="mt-1 flex list-none flex-col gap-1.5 p-0">
              {step.does.map((item, index) => (
                <li key={item.en} className="flex gap-2 text-xs leading-relaxed" style={{ color: "var(--text-muted)" }}>
                  <span className="pi-eyebrow shrink-0 tabular-nums">{index + 1}</span>
                  <span>{item[lang]}</span>
                </li>
              ))}
            </ol>
          </div>

          {shelf.length > 0 ? (
            <div>
              <p className="pi-eyebrow">{copy.toolsHere}</p>
              <p className="mt-1 text-sm" style={{ lineHeight: 1.9 }}>
                {shelf.map((item, index) => (
                  <span key={item.id}>
                    {index > 0 ? <span aria-hidden style={{ color: "var(--text-dim)" }}> · </span> : null}
                    {item.url ? (
                      <a
                        href={item.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="ui-action"
                        title={item.summary}
                        style={{ color: item.status === "using" ? "var(--text)" : "var(--text-muted)" }}
                      >
                        {item.name}
                      </a>
                    ) : (
                      <span title={item.summary} style={{ color: "var(--text-muted)", borderBottom: `1px dotted ${categoryChip(item.category).borderColor}` }}>
                        {item.name}
                      </span>
                    )}
                  </span>
                ))}
              </p>
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

/**
 * One claim, one date, and two ways for it to end.
 *
 * The settle buttons are the only part of this page that can move an idea
 * against your inclination: admitting the claim did not hold parks it. That is
 * the whole point — a list that can only grow is a list you stop reading, and
 * the thing an idea tracker owes you is the occasional "this one is finished".
 */
function Bet({ idea, copy, busy, today, onSave }: {
  idea: Idea;
  copy: ProductCopy;
  busy: boolean;
  today: string;
  onSave: (patch: Record<string, unknown>) => Promise<void>;
}) {
  const [claim, setClaim] = useState(idea.bet?.claim ?? "");
  const [by, setBy] = useState(idea.bet?.by ?? "");
  const savedBet = useRef({ claim: idea.bet?.claim ?? "", by: idea.bet?.by ?? "" });
  useEffect(() => {
    const previous = savedBet.current;
    const next = { claim: idea.bet?.claim ?? "", by: idea.bet?.by ?? "" };
    setClaim(current => current === previous.claim ? next.claim : current);
    setBy(current => current === previous.by ? next.by : current);
    savedBet.current = next;
  }, [idea.bet?.claim, idea.bet?.by]);
  const settled = idea.bet?.settled;
  const overdue = !!idea.bet?.by && !settled && idea.bet.by < today;

  const settle = (verdict: "held" | "broke") =>
    void onSave({ bet: { claim: idea.bet?.claim ?? claim, by: idea.bet?.by ?? by, settled: verdict } });

  return (
    <div className="pi-panel flex flex-col gap-2 p-3">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="pi-eyebrow">{copy.bet}</span>
        {settled ? (
          <span className="pi-eyebrow" style={{ color: settled === "held" ? "var(--success)" : "var(--danger)" }}>
            {settled === "held" ? copy.betSettledHeld : copy.betSettledBroke}
          </span>
        ) : overdue ? (
          <span className="pi-eyebrow" style={{ color: "var(--warning)" }}>{copy.overdue}</span>
        ) : null}
      </div>

      <p className="text-xs" style={{ color: "var(--text-muted)" }}>{copy.hypothesisHint}</p>
      <div className="flex flex-wrap items-end gap-2">
        <input
          value={claim}
          disabled={busy || !!settled}
          onChange={(event) => setClaim(event.target.value)}
          onBlur={() => { if (claim.trim() !== (idea.bet?.claim ?? "")) void onSave(claim.trim() ? { bet: { claim: claim.trim(), by } } : { bet: null }); }}
          placeholder={copy.betPlaceholder}
          aria-label={copy.bet}
          className="pi-panel min-h-[44px] min-w-0 flex-1 basis-64 px-2 text-sm outline-none disabled:opacity-60"
        />
        <label className="flex min-w-0 flex-col gap-1">
          <span className="pi-eyebrow">{copy.betBy}</span>
        <input
          type="date"
          value={by}
          disabled={busy || !claim.trim() || !!settled}
          onChange={(event) => {
            setBy(event.target.value);
            if (claim.trim()) void onSave({ bet: { claim: claim.trim(), by: event.target.value } });
          }}
          aria-label={copy.betBy}
          className="pi-panel min-h-[44px] min-w-0 px-2 text-sm outline-none disabled:opacity-60"
        />
        </label>
      </div>

      {claim.trim() && !settled ? (
        <div className="flex flex-wrap gap-3">
          <button type="button" disabled={busy} onClick={() => settle("held")} className="ui-action pi-bracket min-h-[44px] px-2 text-xs split:min-h-0 split:px-0">{copy.betHeld}</button>
          <button type="button" disabled={busy} onClick={() => settle("broke")} className="ui-action pi-bracket min-h-[44px] px-2 text-xs split:min-h-0 split:px-0" style={{ color: "var(--danger)" }}>{copy.betBroke}</button>
          <p className="w-full text-xs" style={{ color: "var(--text-muted)" }}>{copy.betBrokeHint}</p>
        </div>
      ) : null}

      {settled ? (
        <button
          type="button"
          disabled={busy}
          onClick={() => { setClaim(""); setBy(""); void onSave({ bet: null }); }}
          className="ui-action min-h-[44px] self-start px-2 text-xs split:min-h-0 split:px-0"
          style={{ color: "var(--text-dim)" }}
        >
          {copy.clearBet}
        </button>
      ) : null}
    </div>
  );
}

function IdeaLinks({ idea, copy, busy, onAct, onSave }: {
  idea: Idea;
  copy: ProductCopy;
  busy: boolean;
  onAct: <T,>(run: () => Promise<T>) => Promise<T | null>;
  onSave: (patch: Record<string, unknown>) => Promise<void>;
}) {
  const [url, setUrl] = useState("");
  const [title, setTitle] = useState("");

  const add = async () => {
    if (!url.trim()) return;
    const saved = await onAct(() => jsonRequest<{ link: IdeaLink }>(
      `/api/robin/products/${encodeURIComponent(idea.id)}`,
      "PATCH",
      { link: { url: url.trim(), title: title.trim() } },
    ));
    if (saved) { setUrl(""); setTitle(""); }
  };

  return (
    <div className="flex flex-col gap-2">
      <h3 className="pi-eyebrow">{copy.evidence} · {idea.links.length}</h3>
      {idea.links.length === 0 ? <p className="text-xs" style={{ color: "var(--text-muted)" }}>{copy.noEvidence}</p> : null}
      {idea.links.length > 0 ? (
        <ul className="m-0 flex list-none flex-col gap-1 p-0">
          {idea.links.map((link) => (
            <li key={link.id} className="flex items-start gap-2 border-b py-2" style={{ borderColor: "var(--border)" }}>
              <div className="min-w-0 flex-1" style={{ overflowWrap: "anywhere" }}>
                <a href={link.url} target="_blank" rel="noopener noreferrer" className="ui-action text-sm" style={{ color: "var(--text)" }}>{link.title}</a>
                {link.note ? <p className="mt-1 text-xs" style={{ color: "var(--text-muted)" }}>{link.note}</p> : null}
              </div>
              {/* Where a claim came from stays visible: a link the agent found
                  is not the same as one you chose to keep. */}
              {link.addedBy === "agent" ? <span className="pi-eyebrow shrink-0">{copy.byAgent}</span> : null}
              <button
                type="button"
                disabled={busy}
                aria-label={`${copy.remove} ${link.title}`}
                onClick={() => void onSave({ links: idea.links.filter((item) => item.id !== link.id) })}
                className="ui-action min-h-[44px] shrink-0 px-2 text-xs split:min-h-0 split:px-0"
                style={{ color: "var(--text-dim)" }}
              >
                {copy.remove}
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      <div className="flex flex-wrap gap-2">
        <input
          value={url}
          onChange={(event) => setUrl(event.target.value)}
          onKeyDown={(event) => { if (event.key === "Enter") void add(); }}
          type="text"
          inputMode="url"
          placeholder={copy.url}
          aria-label={copy.url}
          className="pi-panel min-h-[44px] min-w-0 flex-1 basis-48 px-2 text-sm outline-none"
        />
        <input
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          onKeyDown={(event) => { if (event.key === "Enter") void add(); }}
          placeholder={copy.titleField}
          aria-label={copy.titleField}
          className="pi-panel min-h-[44px] min-w-0 flex-1 basis-40 px-2 text-sm outline-none"
        />
        <button type="button" disabled={busy || !url.trim()} onClick={() => void add()} className="ui-action pi-bracket min-h-[44px] px-2 text-xs disabled:opacity-40 split:min-h-0 split:px-0">
          {copy.addLink}
        </button>
      </div>
    </div>
  );
}

/**
 * Direct ideas need no AI. Raw captures are retained before classification;
 * a suggested destination is only written after the user confirms it.
 */
function Capture({ captures, ideas, copy, locale, nameRef, focusRequest, onDone, onCreated }: {
  nameRef: React.RefObject<HTMLInputElement | null>;
  focusRequest: number;
  captures: ProductCapture[];
  ideas: Idea[];
  copy: ProductCopy;
  locale: string;
  onDone: () => Promise<void>;
  onCreated: (idea: Idea) => void;
}) {
  const [mode, setMode] = useState<"idea" | "capture">("idea");
  useEffect(() => {
    if (!focusRequest) return;
    setMode("idea");
    // Wait for the view and input mode to be visible; ordinary tab switches
    // never move focus here or overwrite the capture draft.
    const frame = requestAnimationFrame(() => {
      nameRef.current?.focus();
      nameRef.current?.scrollIntoView({ block: "center" });
    });
    return () => cancelAnimationFrame(frame);
  }, [focusRequest, nameRef]);
  const [name, setName] = useState("");
  const [text, setText] = useState("");
  const [images, setImages] = useState<Array<{ data: string; mimeType: string }>>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [review, setReview] = useState<{ capture: ProductCapture; suggestion: Suggestion } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const run = async (work: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await work();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setBusy(false);
    }
  };

  const classify = (capture: ProductCapture) => run(async () => {
    const { suggestion } = await jsonRequest<{ suggestion: Suggestion }>("/api/robin/product-classify", "POST", { id: capture.id });
    setReview({ capture, suggestion });
  });

  const save = () => {
    if (busy) return;
    return run(async () => {
      if (mode === "idea") {
        if (!name.trim()) return;
        const { idea } = await jsonRequest<{ idea: Idea }>("/api/robin/products", "POST", { name: name.trim(), note: text });
        setName("");
        setText("");
        await onDone();
        onCreated(idea);
        return;
      }
      if (!text.trim() && images.length === 0) return;
      const { capture } = await jsonRequest<{ capture: ProductCapture }>("/api/robin/products", "POST", { capture: true, text, images });
      setText("");
      setImages([]);
      await onDone();
      try {
        const { suggestion } = await jsonRequest<{ suggestion: Suggestion }>("/api/robin/product-classify", "POST", { id: capture.id });
        setReview({ capture, suggestion });
      } catch (caught) {
        throw new Error(`${copy.savedCapture} ${caught instanceof Error ? caught.message : String(caught)}`);
      }
    });
  };

  return (
    <section className={`${styles.capture} pi-card flex min-w-0 flex-col gap-3 p-4`} aria-labelledby="product-capture-title">
      <header>
        <span className={styles.captureIcon}><ProductGlyph name="idea" /></span>
        <h2 id="product-capture-title" tabIndex={-1} className="pi-label">{copy.captureTitle}</h2>
        <p className="mt-2 text-xs" style={{ color: "var(--text-muted)" }}>{copy.captureHint}</p>
      </header>
      <div className={styles.filters} role="group" aria-label={copy.type}>
        <button type="button" disabled={busy} aria-pressed={mode === "idea"} data-selected={mode === "idea"} onClick={() => setMode("idea")} className="ui-action min-h-[44px] flex-1 px-2 text-xs">{copy.directIdea}</button>
        <button type="button" disabled={busy} aria-pressed={mode === "capture"} data-selected={mode === "capture"} onClick={() => setMode("capture")} className="ui-action min-h-[44px] flex-1 px-2 text-xs">{copy.rawCapture}</button>
      </div>
      {mode === "idea" ? (
        <label className="flex flex-col gap-2">
          <span className="pi-eyebrow">{copy.ideaName}</span>
          <input ref={nameRef} value={name} disabled={busy} onChange={(event) => setName(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.nativeEvent.isComposing) { event.preventDefault(); void save(); } }} placeholder={copy.newIdeaName} className="pi-panel min-h-[44px] w-full text-sm" />
        </label>
      ) : null}
      <label className="flex flex-col gap-2">
        <span className="pi-eyebrow">{mode === "idea" ? copy.note : copy.original}</span>
        <textarea
          value={text}
          disabled={busy}
          onChange={(event) => setText(event.target.value)}
          placeholder={mode === "idea" ? copy.notePlaceholder : copy.capturePlaceholder}
          rows={4}
          className="pi-panel w-full resize-y p-3 text-sm outline-none"
        />
      </label>

      {mode === "capture" && images.length > 0 ? (
        <ul className="m-0 flex list-none flex-wrap gap-2 p-0" aria-label={`${images.length} ${copy.images}`}>
          {images.map((image, index) => (
            <li key={`${image.mimeType}:${index}`} className="relative size-16 border" style={{ borderColor: "var(--border)" }}>
              {/* The bytes are already local preview data; loading them through
                  an image endpoint would only round-trip what the browser has. */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={`data:${image.mimeType};base64,${image.data}`}
                alt=""
                className="size-full object-cover"
              />
              <button
                type="button"
                disabled={busy}
                onClick={() => setImages((current) => current.filter((_, itemIndex) => itemIndex !== index))}
                aria-label={`${copy.removeImage} ${index + 1}`}
                className="ui-action ui-action--surface absolute right-0 top-0 flex size-8 items-center justify-center text-sm"
                style={{ background: "var(--bg-panel)", color: "var(--text)" }}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      <div className="flex flex-wrap items-center gap-3">
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          multiple
          disabled={busy}
          hidden
          onChange={async (event) => {
            const files = [...(event.target.files ?? [])];
            event.target.value = "";
            await run(async () => {
              const attached = await Promise.all(files.map((file) => compressImageFile(file)));
              setImages((current) => [...current, ...attached]);
            });
          }}
        />
        {mode === "capture" ? <button type="button" disabled={busy} onClick={() => fileRef.current?.click()} className="ui-action pi-bracket min-h-[44px] text-xs disabled:opacity-40">
          {copy.attach}{images.length > 0 ? ` · ${images.length}` : ""}
        </button> : null}
        <button
          type="button"
          disabled={busy || (mode === "idea" ? !name.trim() : !text.trim() && images.length === 0)}
          onClick={() => void save()}
          className="ui-action pi-bracket min-h-[44px] text-xs disabled:opacity-40"
          data-state="accent"
        >
          {busy ? (mode === "idea" ? copy.saving : copy.classifying) : mode === "idea" ? copy.createIdea : copy.capture}
        </button>
      </div>
      {mode === "capture" ? <p className="text-xs" style={{ color: "var(--text-muted)" }}>{copy.capturePrivacy}</p> : null}

      {captures.length > 0 ? (
        <div className="flex flex-col gap-1 border-t pt-3" style={{ borderColor: "var(--border)" }}>
          <p className="pi-eyebrow px-1">{copy.pendingCaptures} · {captures.length}</p>
          <ul className="m-0 flex list-none flex-col p-0">
            {captures.map((capture) => {
              const preview = capture.text.trim().replace(/\s+/g, " ") || `${capture.images.length} ${copy.images}`;
              const firstImage = capture.images[0];
              return (
                <li key={capture.id}>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void classify(capture)}
                    className="ui-action ui-action--surface flex min-h-[44px] w-full items-center gap-2 px-1 text-left disabled:opacity-40"
                  >
                    {firstImage ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={`data:${firstImage.mimeType};base64,${firstImage.data}`}
                        alt=""
                        className="size-8 shrink-0 border object-cover"
                        style={{ borderColor: "var(--border)" }}
                      />
                    ) : null}
                    <span className="min-w-0 flex-1 truncate text-xs" style={{ color: "var(--text)" }}>{preview}</span>
                    <span className="pi-eyebrow shrink-0">
                      {new Date(capture.createdAt).toLocaleDateString(locale, { month: "short", day: "numeric" })}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}

      {error ? <p role="alert" className="text-xs" style={{ color: "var(--danger)" }}>{error}</p> : null}

      {review ? (
        <Review
          key={review.capture.id}
          review={review}
          ideas={ideas}
          copy={copy}
          busy={busy}
          onCancel={() => setReview(null)}
          onFiled={async () => { setReview(null); await onDone(); }}
          onError={setError}
        />
      ) : null}
    </section>
  );
}

function Review({ review, ideas, copy, busy, onCancel, onFiled, onError }: {
  review: { capture: ProductCapture; suggestion: Suggestion };
  ideas: Idea[];
  copy: ProductCopy;
  busy: boolean;
  onCancel: () => void;
  onFiled: () => Promise<void>;
  onError: (message: string) => void;
}) {
  const [kind, setKind] = useState(review.suggestion.kind);
  const [title, setTitle] = useState(review.suggestion.title);
  const [summary, setSummary] = useState(review.suggestion.summary);
  const [ideaId, setIdeaId] = useState(ideas[0]?.id ?? "");
  const [submitting, setSubmitting] = useState(false);
  const disabled = busy || submitting;

  const submit = async () => {
    if (disabled) return;
    setSubmitting(true);
    try {
      await jsonRequest("/api/robin/products", "POST", {
        captureId: review.capture.id,
        kind,
        title,
        summary,
        ...(review.suggestion.url ? { url: review.suggestion.url } : {}),
        ...(kind === "link" ? { ideaId } : {}),
      });
      await onFiled();
    } catch (caught) {
      onError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form
      className="pi-panel flex flex-col gap-3 p-3"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
        <span className="pi-label">{copy.suggestion}</span>
        <span className="pi-eyebrow">{copy.confidence}: {review.suggestion.confidence}</span>
      </div>
      <p className="text-xs" style={{ color: "var(--text-muted)" }}>{review.suggestion.reason}</p>

      <div className="flex flex-wrap gap-2">
        <select value={kind} disabled={disabled} onChange={(event) => setKind(event.target.value as Suggestion["kind"])} aria-label={copy.type} className="pi-panel min-h-[44px] basis-32 px-2 text-sm disabled:opacity-60">
          <option value="idea">{copy.idea}</option>
          <option value="resource">{copy.resource}</option>
          <option value="link">{copy.link}</option>
          <option value="note">{copy.note}</option>
        </select>
        {kind === "link" ? (
          <select value={ideaId} disabled={disabled} onChange={(event) => setIdeaId(event.target.value)} aria-label={copy.ideas} className="pi-panel min-h-[44px] min-w-0 flex-1 basis-48 px-2 text-sm disabled:opacity-60">
            {ideas.map((idea) => <option key={idea.id} value={idea.id}>{idea.name}</option>)}
          </select>
        ) : null}
        <input value={title} disabled={disabled} onChange={(event) => setTitle(event.target.value)} aria-label={copy.titleField} className="pi-panel min-h-[44px] min-w-0 flex-1 basis-48 px-2 text-sm disabled:opacity-60" />
      </div>
      <textarea value={summary} disabled={disabled} onChange={(event) => setSummary(event.target.value)} aria-label={copy.note} rows={2} className="pi-panel w-full resize-y p-2 text-sm disabled:opacity-60" />

      <div className="flex flex-wrap gap-3">
        <button type="submit" disabled={disabled || !title.trim() || (kind === "link" && !ideaId)} className="ui-action pi-bracket min-h-[44px] px-2 text-xs disabled:opacity-40 split:min-h-0 split:px-0" data-state="accent">{submitting ? copy.saving : copy.confirm}</button>
        <button type="button" disabled={disabled} onClick={onCancel} className="ui-action min-h-[44px] px-2 text-xs disabled:opacity-40 split:min-h-0 split:px-0">{copy.cancel}</button>
      </div>
    </form>
  );
}
