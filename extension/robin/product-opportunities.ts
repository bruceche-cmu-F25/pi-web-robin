import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { readJsonObject, updateJsonObject } from "./paths.ts";
import { addIdea, addIdeaLink, getIdea, listIdeas, type Idea } from "./product-domain.ts";
import { localDate } from "./dates.ts";
import { PRODUCT_CASES, caseIdeaDraft, type CaseAngle } from "./product-cases.ts";

const SOURCE = "https://www.starterstory.com/data/ios-app-ideas";
const FILE = "product-opportunities.json";
const DAILY_LIMIT = 3;

export interface Opportunity {
  id: string;
  title: string;
  url: string;
  /** Public-list icon; not independent evidence for the revenue claim. */
  logoUrl?: string;
  /** First day this recommendation entered the list; never reset by a re-scan. */
  discoveredOn?: string;
  revenue: string;
  /** Monthly figure as claimed by the source; null means undisclosed. */
  monthlyUsd: number | null;
  source?: string;
  productHost?: string;
  soloScore?: number;
  revenueBasis: "estimated" | "reported" | "unspecified";
  match: string;
  relatedIdea?: string;
  angle: string;
  mvp: string;
  charge: string;
  experiment: string;
  transfer?: string;
}

interface OpportunityState {
  checkedAt?: string;
  attemptedAt?: string;
  error?: string;
  opportunities: Opportunity[];
  /** Current directory snapshot; older daily picks remain untouched above. */
  catalog?: Opportunity[];
  catalogSource?: string;
  attemptedSource?: string;
}

type Listing = Pick<Opportunity, "id" | "title" | "url" | "revenue" | "monthlyUsd" | "revenueBasis" | "logoUrl" | "source" | "productHost" | "soloScore">;

function plain(text: string): string {
  return text.replace(/<[^>]*>/g, "").replace(/&(?:amp|quot|#39|lt|gt);/g, (value) => ({
    "&amp;": "&", "&quot;": '"', "&#39;": "'", "&lt;": "<", "&gt;": ">",
  })[value] ?? value).trim();
}

/** Parse only the publicly visible row view; don't fetch locked case studies. */
export function parseListings(html: string): Listing[] {
  const section = html.split('id="db-view-rows"')[1]?.split('id="db-view-cards"')[0] ?? "";
  const found: Listing[] = [];
  const rows = /<a\b[^>]*data-posthog-action="view_case_study"[^>]*href="(\/(?:businesses|stories)\/[a-z0-9-]+)"[^>]*>([\s\S]*?)<\/a>/g;
  for (const match of section.matchAll(rows)) {
    // Blurred rows are gated previews, not public opportunities to index.
    if (/\bblur-row\b/.test(match[0].split(">", 1)[0] ?? "")) continue;
    const body = match[2] ?? "";
    const name = body.match(/<div class="text-sm font-semibold text-slate-900 truncate">([^<]+)<\/div>/);
    const tagged = body.match(/<span\b[^>]*title="([^"]*)"[^>]*>(\$[\d,.]+[KMB]?\/mo)<\/span>/i);
    const generic = body.match(/(\$[\d,.]+[KMB]?)<\/span>\s*<span[^>]*>\/mo<\/span>/i);
    if (!name) continue;
    const revenue = tagged?.[2] ?? (generic ? `${generic[1]}/mo` : "—");
    const amount = revenue.match(/^\$([\d,.]+)([KMB]?)\/mo$/i);
    const parsed = amount ? Number(amount[1]!.replaceAll(",", "")) * ({ K: 1_000, M: 1_000_000, B: 1_000_000_000 }[amount[2]!.toUpperCase()] ?? 1) : null;
    const monthlyUsd = parsed !== null && Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
    const id = match[1]!.startsWith("/businesses/") ? match[1]!.slice("/businesses/".length) : `stories-${match[1]!.slice("/stories/".length)}`;
    if (found.some((item) => item.id === id)) continue;
    const label = plain(tagged?.[1] ?? "").toLowerCase();
    const logo = body.match(/<img alt="" src="(https:\/\/d1coqmn8qm80r4\.cloudfront\.net\/[a-z0-9]+)"/);
    const host = body.match(/<span[^>]*class="font-mono text-slate-400 truncate[^"\n]*"[^>]*>([a-z0-9.-]+\.[a-z]{2,})<\/span>/i)?.[1];
    const score = body.match(/Solopreneur\s+(\d+(?:\.\d+)?)/)?.[1];
    found.push({ id, title: plain(name[1]!), url: `https://www.starterstory.com${match[1]}`,
      ...(logo ? { logoUrl: logo[1] } : {}), ...(host ? { productHost: host } : {}),
      ...(score && Number(score) <= 100 ? { soloScore: Number(score) } : {}), revenue, monthlyUsd,
      revenueBasis: label.includes("estimated") ? "estimated" : label.includes("self-reported") ? "reported" : "unspecified" });
  }
  return found;
}

/** Directions come from actual idea names, not a made-up candidate profile. */
const DIRECTIONS = [
  { subject: /gmail|email marketing|email campaign|cold email/i, portfolio: /outreach|营销|群发/i, match: "邮件营销", angle: "从通用营销平台缩到一种细分客户的邮件审核工作流；是否有需求需访谈验证。", mvp: "导入联系人，人工审核一份邮件草稿并跟踪发送结果。", charge: "按账号订阅；先向 5 位目标用户询问付费意愿。", experiment: "与当前群发流程对比，测量单次活动的准备时间是否减少 ≥10%。" },
  { subject: /inbox|邮件整理/i, portfolio: /email|邮件/i, match: "邮件工作流", angle: "聚焦高管收件箱的待办提取与回复草稿；是否更好，需要访谈验证。", mvp: "连接一个 Gmail 账号，生成待处理摘要和待审核回复，不自动发送。", charge: "按账号订阅；先向 5 位目标用户询问付费意愿。", experiment: "和现有收件箱流程对照，测量每周处理邮件所用时间是否减少 ≥10%。" },
  { subject: /benchmark|database|analytics|intelligence|AEO/i, portfolio: /agent|工作台/i, match: "AI 市场调研", angle: "用可追溯来源的研究 Agent 给独立开发者做细分 SaaS 市场对标；是否优于现有数据库待验证。", mvp: "手工整理 20 家同类 SaaS 的公开定价和增长信号，逐项标注来源与估算口径。", charge: "按月卖细分市场报告与更新；先试 3 个付费预订。", experiment: "让 5 位开发者完成同一个竞品调研任务，比较耗时是否减少 ≥10%。" },
  { subject: /resume|career|job/i, portfolio: /mentor|career|求职/i, match: "职业与 AI 助手", angle: "不做泛用简历生成器，聚焦一个求职群体的岗位匹配与可编辑证据；差异尚未验证。", mvp: "上传简历与岗位链接，只输出有出处的匹配差距和一版可修改简历。", charge: "按次收费或小额订阅；先试 5 次真实付费交付。", experiment: "盲测修改前后岗位匹配结果；目标提升 ≥10%，不把主观评分当录用率。" },
  { subject: /store locator/i, portfolio: /local retail|门店/i, match: "垂直 Web SaaS", angle: "聚焦少量门店的独立零售商，减少嵌入地图的配置步骤；先访谈店主确认需求。", mvp: "CSV 导入门店地址，生成一个可嵌入的网站地图与联系按钮。", charge: "按门店数量收月费；先找 3 家商户试用并询价。", experiment: "对照现有门店定位工具，测量首次上线耗时是否减少 ≥10%。" },
  { subject: /voice note|note-taking|transcrib/i, portfolio: /输入法|agent|工作台/i, match: "语音输入与个人 Agent", angle: "语音转文字后直接整理为可审核的待办和资料，而非只生成转录稿；先确认实际使用频率。", mvp: "上传一段语音，转录并提取可编辑的待办清单；不自动执行。", charge: "免费试用后按月订阅或按时长收费；先测 5 位真实用户的付费意愿。", experiment: "对照手动整理笔记，测量完成一次记录与归档所需时间是否减少 ≥10%。" },
  { subject: /interactive demos/i, portfolio: /工作台|agent/i, match: "B2B 产品演示", angle: "只做一段可交互的产品演示，用于小团队发给潜在客户；不复制完整演示平台。", mvp: "上传一段录屏，标记三个可点击步骤并生成可分享链接。", charge: "按团队订阅；先做 3 次人工交付验证付费。", experiment: "对照普通录屏，测量潜在客户完成演示的比例能否提升 ≥10%。" },
  { subject: /open source|scheduling|productivity|video clipping|creator/i, portfolio: /社媒|内容|播客|短视频|creator/i, match: "自动化与创作工具", angle: "不复制全功能平台，挑一个重复的创作/运营步骤做得更省事；先确认实际痛点。", mvp: "选一个具体任务，做输入→人工审核→导出的单流程 Web 工具。", charge: "按用量或月订阅；先向 5 个实际使用者卖人工版。", experiment: "记录任务完成时间和返工次数，检验是否节省 ≥10%。" },
] as const;

export function recommend(listings: Listing[], ideas: Pick<Idea, "name">[]): Opportunity[] {
  const matched = listings.map((item) => {
    // The chosen directory, not our former SaaS keywords/revenue band, defines scope.
    const direction = DIRECTIONS.find((entry) => entry.subject.test(item.title)) ?? {
      portfolio: /$^/, match: "待研究的 App",
      angle: "先实际体验产品，找出一个重复操作或失败点；只针对它提出可测量的 10% 改进，不假定已有痛点。",
      mvp: "只复现一个核心任务的原型，先对照原产品测试，不照搬整个产品。",
      charge: "核查当前商店定价与付费墙，再测试用户是否愿意为这个差异付费。",
      experiment: "找 5 位目标用户做同一个任务，比较耗时、成功率或复用；原产品收入不算你的验证。",
    };
    const related = ideas.find((idea) => direction.portfolio.test(idea.name));
    return { ...item, match: direction.match, ...(related ? { relatedIdea: related.name } : {}),
      angle: direction.angle, mvp: direction.mvp, charge: direction.charge, experiment: direction.experiment,
      transfer: "找另一类也需要完成同一任务的人，验证原机制是否适用；换人群不是只换文案，不能沿用原产品的需求结论。" };
  });
  return matched.sort((a, b) => Number(!!b.relatedIdea) - Number(!!a.relatedIdea));
}

/** Existing candidates stay in the list; a day contributes at most three *new* URLs. */
export function appendOpportunities(previous: Opportunity[], candidates: Opportunity[], today: string): Opportunity[] {
  const known = new Set(previous.map((item) => item.url));
  const byUrl = new Map(candidates.map((item) => [item.url, item]));
  const remaining = Math.max(0, DAILY_LIMIT - previous.filter((item) => item.discoveredOn === today).length);
  const additions: Opportunity[] = [];
  for (const candidate of candidates) {
    if (known.has(candidate.url) || additions.length >= remaining) continue;
    known.add(candidate.url);
    additions.push({ ...candidate, discoveredOn: today });
  }
  // Enrich legacy cards with the public icon without re-dating or replacing
  // the idea's original analysis; a refresh never counts as a new discovery.
  return [...additions, ...previous.map((item) => item.logoUrl ? item : {
    ...item, ...(byUrl.get(item.url)?.logoUrl ? { logoUrl: byUrl.get(item.url)!.logoUrl } : {}),
  })];
}

let running: Promise<void> | null = null;

/** Assessment never triggers discovery or silently substitutes a legacy candidate. */
export function getCatalogOpportunity(id: string): Opportunity | null {
  const state = readJsonObject<OpportunityState>(FILE);
  return state?.catalogSource === SOURCE ? state.catalog?.find((item) => item.id === id) ?? null : null;
}

export function opportunityBoard(now = Date.now()): OpportunityState & { scanning: boolean; source: string; scheduled: boolean; savedIds: string[] } {
  const state = readJsonObject<OpportunityState>(FILE) ?? { opportunities: [] };
  // Local calendar days, not UTC 24-hour windows. Never retry on every UI poll.
  const today = localDate(new Date(now));
  if (!running && (state.catalogSource !== SOURCE || !state.checkedAt || localDate(new Date(state.checkedAt)) < today)
    && (state.attemptedSource !== SOURCE || !state.attemptedAt || localDate(new Date(state.attemptedAt)) < today)) startOpportunityScan();
  const catalog = state.catalogSource === SOURCE ? state.catalog ?? [] : [];
  return { ...state, opportunities: catalog, checkedAt: state.catalogSource === SOURCE ? state.checkedAt : undefined,
    scanning: !!running, source: SOURCE,
    scheduled: process.platform === "darwin" && existsSync(join(homedir(), "Library/LaunchAgents/works.robin.product-opportunities.plist")),
    savedIds: catalog.filter((item) => getIdea(`starter-story-${item.id}`)).map((item) => item.id) };
}

/** The chosen angle is a hypothesis, never a claim that this user's idea is validated. */
export function saveCaseOpportunity(caseId: string, angle: CaseAngle, lang: "zh" | "en"): Idea {
  const item = PRODUCT_CASES.find((entry) => entry.id === caseId);
  if (!item || (angle !== "improve" && angle !== "transfer")) throw new Error("Case or angle not found");
  const idea = addIdea({ id: `case-${caseId}-${angle}`, ...caseIdeaDraft(item, angle, lang) });
  addIdeaLink(idea.id, { id: `case-source-${caseId}`, title: `Starter Story · ${item.name}`, url: item.source,
    note: `Public video transcript; read ${item.checkedOn}. Founder-reported, not independently verified.` });
  return getIdea(idea.id) ?? idea;
}

/** A suggestion becomes the user's idea only after they explicitly save it. */
export function saveOpportunity(id: string): Idea {
  const state = readJsonObject<OpportunityState>(FILE);
  const opportunity = [...(state?.catalog ?? []), ...(state?.opportunities ?? [])].find((item) => item.id === id);
  if (!opportunity) throw new Error("Opportunity not found");
  const idea = addIdea({
    id: `starter-story-${id}`, name: opportunity.title,
    note: `Source list: ${opportunity.source ?? "Legacy listing; discovery page not recorded"}\nProduct detail: ${opportunity.url}\nSource monthly revenue: ${opportunity.revenue} (${opportunity.revenueBasis}; not independently verified, not profit).\n\nUnvalidated hypotheses / 未验证假设（类别模板，不是产品调研结论）\nPossible improvement: ${opportunity.angle}\nContext transfer: ${opportunity.transfer ?? "Not researched"}\nMVP: ${opportunity.mvp}\nMonetization to test: ${opportunity.charge}\n10% experiment: ${opportunity.experiment}`,
  });
  addIdeaLink(idea.id, { id: `source-${id}`, title: "Starter Story product detail", url: opportunity.url, note: "Public-list lead; independent verification still needed." });
  if (opportunity.source) addIdeaLink(idea.id, { id: `directory-${id}`, title: "Starter Story · iOS App Ideas", url: opportunity.source, note: "Discovery directory, not a founder interview or validation of the derivative idea." });
  return getIdea(idea.id) ?? idea;
}

export function startOpportunityScan(fetchImpl: typeof fetch = fetch, now = Date.now()): boolean {
  if (running) return false;
  running = (async () => {
    try {
      const response = await fetchImpl(SOURCE, { signal: AbortSignal.timeout(15_000), headers: { "User-Agent": "RobinProductResearch/1.0 (personal daily public-page reader)" } });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const listings = parseListings(await response.text()).map((item) => ({ ...item, source: SOURCE }));
      if (!listings.length) throw new Error("No public rows parsed");
      const checkedAt = new Date(now).toISOString();
      const candidates = recommend(listings, listIdeas());
      updateJsonObject<OpportunityState, void>(FILE, (current) => {
        const previous = current ?? { opportunities: [] };
        // Upgrade the original weekly picks without pretending they were new today.
        const retained = previous.opportunities.map((item) => ({ ...item,
          discoveredOn: item.discoveredOn ?? localDate(new Date(previous.checkedAt ?? now)),
        }));
        return { value: { ...previous, checkedAt, attemptedAt: checkedAt, attemptedSource: SOURCE,
          catalogSource: SOURCE, catalog: candidates,
          opportunities: appendOpportunities(retained, candidates, localDate(new Date(now))),
          error: undefined }, result: undefined, changed: true };
      });
    } catch (error) {
      updateJsonObject<OpportunityState, void>(FILE, (current) => ({
        value: { ...(current ?? { opportunities: [] }), attemptedAt: new Date(now).toISOString(), attemptedSource: SOURCE,
          error: error instanceof Error ? error.message : String(error) },
        result: undefined, changed: true,
      }));
    }
  })().finally(() => { running = null; });
  return true;
}

/** Used by the local daily scheduler: skip a day already checked, wait for persistence. */
export async function updateDailyOpportunities(): Promise<OpportunityState> {
  opportunityBoard();
  if (running) await running;
  return readJsonObject<OpportunityState>(FILE) ?? { opportunities: [] };
}
