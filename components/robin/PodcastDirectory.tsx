"use client";

import { useEffect, useMemo, useState } from "react";
import {
  PODCAST_CHANNELS,
  PODCAST_PEOPLE,
  PODCAST_SHELVES,
  channelById,
  describeEpisode,
  formatClock,
  formatLength,
  watchUrl,
  type EpisodeSummary,
  type FeedEpisode,
  type Interview,
  type Localized,
  type PodcastShelf,
  type PodcastView,
  type VideoDetails,
} from "@/extension/robin/podcasts";
import { useI18n } from "@/hooks/useI18n";
import { usePolledResource } from "./usePolledResource";
import styles from "./PodcastDirectory.module.css";

type Response = PodcastView & { scanning: boolean; summarizing: string[] };

const SHELF_LABEL: Record<PodcastShelf, Localized> = {
  ai: { en: "Frontier AI", zh: "前沿 AI" },
  labs: { en: "Labs & lectures", zh: "实验室与课程" },
  engineering: { en: "AI engineering", zh: "AI 工程" },
  product: { en: "Product", zh: "产品" },
  startups: { en: "Startup stories", zh: "创业故事" },
};

const LATEST_PAGE = 12;

/** Communities to find the next episode in — signal, not source of record. */
const DISCOVERY = [
  { label: "r/MachineLearning", url: "https://www.reddit.com/r/MachineLearning/" },
  { label: "r/LocalLLaMA", url: "https://www.reddit.com/r/LocalLLaMA/" },
  { label: "r/singularity", url: "https://www.reddit.com/r/singularity/" },
  { label: "r/startups", url: "https://www.reddit.com/r/startups/" },
  { label: "r/podcasts", url: "https://www.reddit.com/r/podcasts/" },
  { label: "Hacker News", url: "https://news.ycombinator.com/" },
];

/** Open-source tools behind, or next to, how this page reads episodes. */
const TOOLS = [
  {
    label: "youtube-transcript-api",
    url: "https://github.com/jdepoix/youtube-transcript-api",
    note: { en: "MIT · Python. This page ports its transcript method.", zh: "MIT · Python。本页的字幕抓取方法移植自它。" },
  },
  {
    label: "steipete/summarize",
    url: "https://github.com/steipete/summarize",
    note: { en: "MIT · CLI + extension for pages, YouTube and podcasts.", zh: "MIT · CLI 与浏览器扩展，支持网页、YouTube、播客。" },
  },
  {
    label: "yt-dlp",
    url: "https://github.com/yt-dlp/yt-dlp",
    note: { en: "Unlicense · downloads audio and subtitles from most sites.", zh: "Unlicense · 从大多数网站下载音频与字幕。" },
  },
  {
    label: "openai/whisper",
    url: "https://github.com/openai/whisper",
    note: { en: "MIT · transcribes audio-only podcasts locally; installed here.", zh: "MIT · 本地转录纯音频播客；本机已安装。" },
  },
];

function useText() {
  const { locale } = useI18n();
  const zh = locale === "zh-CN";
  return {
    zh,
    locale,
    t: (value: Localized) => (zh ? value.zh : value.en),
    L: (en: string, zhText: string) => (zh ? zhText : en),
  };
}

function formatDate(iso: string | undefined, locale: string): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat(locale, { year: "numeric", month: "short", day: "numeric" }).format(date);
}

function formatAgo(iso: string | null | undefined, locale: string): string {
  if (!iso) return "";
  const minutes = Math.round((Date.now() - Date.parse(iso)) / 60_000);
  if (!Number.isFinite(minutes)) return "";
  const format = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
  if (minutes < 60) return format.format(-Math.max(0, minutes), "minute");
  if (minutes < 60 * 24) return format.format(-Math.round(minutes / 60), "hour");
  return format.format(-Math.round(minutes / 1440), "day");
}

/** "3 days ago" while it is news; past two months, "Feb 2025" says more than "561 days ago". */
function lastSeen(iso: string | undefined, locale: string): string {
  if (!iso) return "";
  if (Date.now() - Date.parse(iso) < 60 * 86_400_000) return formatAgo(iso, locale);
  return new Intl.DateTimeFormat(locale, { year: "numeric", month: "short" }).format(new Date(iso));
}

/** "Slides provided by Andrej: https://…" reads as a dangling colon without the link. */
function stripUrls(text: string): string {
  return text
    .split("\n")
    .map((line) => (/https?:\/\//.test(line) ? line.replace(/\s*https?:\/\/\S+/g, "").replace(/(^|[.!?]\s+)[^.!?]*:\s*$/, "$1").trimEnd() : line))
    .join("\n")
    .trim();
}

// ---------------------------------------------------------------------------

type SummaryLang = "both" | "zh" | "en";
const SUMMARY_LANGS: Array<{ key: SummaryLang; label: string }> = [
  { key: "both", label: "中英" },
  { key: "zh", label: "中" },
  { key: "en", label: "EN" },
];
const SUMMARY_LANG_KEY = "robin-podcast-summary-lang";

/**
 * One summary line in the chosen language(s). Side by side, the interface
 * language leads and the other follows in a quieter voice; a summary whose zh
 * fell back to the English shows it once.
 */
function Bilingual({ value, lang, zhFirst }: { value: Localized; lang: SummaryLang; zhFirst: boolean }) {
  const order: Array<"en" | "zh"> = lang === "both" ? (zhFirst ? ["zh", "en"] : ["en", "zh"]) : [lang];
  const parts = order.filter((key, index) => index === 0 || value[key] !== value[order[0] as "en" | "zh"]);
  return (
    <>
      {parts.map((key, index) => (
        <span key={key} lang={key === "zh" ? "zh-CN" : "en"} className={index === 0 ? styles.primary : styles.secondary}>{value[key]}</span>
      ))}
    </>
  );
}

function LangSwitch({ value, onChange, label }: { value: SummaryLang; onChange: (next: SummaryLang) => void; label: string }) {
  return (
    <span className={styles.langSwitch} role="group" aria-label={label}>
      {SUMMARY_LANGS.map((item) => (
        <button key={item.key} type="button" aria-pressed={value === item.key} data-active={value === item.key || undefined} onClick={() => onChange(item.key)}>
          {item.label}
        </button>
      ))}
    </span>
  );
}

interface EpisodeCardProps {
  videoId: string;
  title: string;
  show: string;
  published?: string;
  details?: VideoDetails;
  description: string;
  note?: Localized;
  summary?: EpisodeSummary;
  summarizing: boolean;
  error?: string;
  onSummarize: (videoId: string) => void;
  summaryLang: SummaryLang;
  onSummaryLang: (next: SummaryLang) => void;
}

function EpisodeCard(props: EpisodeCardProps) {
  const { t, L, zh, locale } = useText();
  const { videoId, title, show, published, details, description, note, summary, summarizing, error, onSummarize, summaryLang, onSummaryLang } = props;
  const [open, setOpen] = useState(false);
  const [summaryOpen, setSummaryOpen] = useState(false);
  const { lead, chapters } = useMemo(() => describeEpisode(description), [description]);
  const cleanLead = stripUrls(lead);
  const length = details?.lengthSeconds ? formatLength(details.lengthSeconds) : "";
  const date = formatDate(details?.published ?? published, locale);
  // With a summary on the card the description is folded away entirely.
  const expandable = chapters.length > 0 || cleanLead.length > (summary ? 0 : 220);

  return (
    <article className={styles.episode} data-expanded={open || (summaryOpen && !!summary) || undefined}>
      <div className={styles.episodeGrid}>
        <a className={styles.thumb} href={watchUrl(videoId)} target="_blank" rel="noopener noreferrer" tabIndex={-1} aria-hidden="true">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={`https://i.ytimg.com/vi/${videoId}/mqdefault.jpg`} alt="" width={320} height={180} loading="lazy" decoding="async" />
          {length && <span className={styles.length}>{length}</span>}
        </a>

        <div className={styles.head}>
          <p className={`pi-eyebrow ${styles.meta}`}>
            <span>{show}</span>
            {date && <><span aria-hidden="true">·</span><time dateTime={details?.published ?? published}>{date}</time></>}
          </p>
          <h3 className={styles.episodeTitle}>
            <a href={watchUrl(videoId)} target="_blank" rel="noopener noreferrer">{title}</a>
          </h3>
        </div>

        <div className={styles.rest}>
          {note && <p className={styles.note} lang={zh ? "zh-CN" : "en"}>{t(note)}</p>}

          {summary ? (
            <div className={styles.tldr}>
              <div className={styles.tldrHead}>
                <span className="pi-eyebrow">{L("TL;DR", "摘要")}</span>
                <LangSwitch value={summaryLang} onChange={onSummaryLang} label={L("Summary language", "摘要语言")} />
              </div>
              <p><Bilingual value={summary.tldr} lang={summaryLang} zhFirst={zh} /></p>
            </div>
          ) : cleanLead ? (
            // Folded, the paragraphs run on; a blank line would spend one of the three.
            <p className={styles.lead} data-open={open || undefined}>{open ? cleanLead : cleanLead.replace(/\s*\n\s*/g, " ")}</p>
          ) : null}

          {open && summary && cleanLead && <p className={styles.lead} data-open>{cleanLead}</p>}

          {open && chapters.length > 0 && (
            <ol className={styles.chapters} aria-label={L("Chapters", "章节")}>
              {chapters.map((chapter) => (
                <li key={`${chapter.seconds}-${chapter.label}`}>
                  <a href={watchUrl(videoId, chapter.seconds)} target="_blank" rel="noopener noreferrer">
                    <time>{formatClock(chapter.seconds)}</time>
                    <span>{chapter.label}</span>
                  </a>
                </li>
              ))}
            </ol>
          )}

          {summary && summaryOpen && (
            <ol className={styles.points} aria-label={L("Key points", "要点")}>
              {summary.points.map((point, index) => (
                <li key={index}>
                  {point.at !== null
                    ? <a href={watchUrl(videoId, point.at)} target="_blank" rel="noopener noreferrer"><time>{formatClock(point.at)}</time></a>
                    : <time aria-hidden="true">—</time>}
                  <span className={styles.pointText}><Bilingual value={point} lang={summaryLang} zhFirst={zh} /></span>
                </li>
              ))}
              {summary.truncated && <li className={styles.pointNote}>{L("Long episode: the summary covers roughly the first six hours.", "节目较长：摘要只覆盖前约 6 小时。")}</li>}
            </ol>
          )}

          {error && <p role="alert" className={styles.error}>{error}</p>}

          <div className={styles.actions}>
            {expandable && (
              <button type="button" className="ui-action pi-chrome-label pi-bracket" aria-expanded={open} onClick={() => setOpen((value) => !value)}>
                {open
                  ? L("Less", "收起")
                  : chapters.length > 0 ? L(`${chapters.length} chapters`, `${chapters.length} 个章节`) : L("More", "展开")}
              </button>
            )}
            {summary ? (
              <button type="button" className="ui-action pi-chrome-label pi-bracket" data-state="accent" aria-expanded={summaryOpen} onClick={() => setSummaryOpen((value) => !value)}>
                {summaryOpen ? L("Hide points", "收起要点") : L(`${summary.points.length} key points`, `${summary.points.length} 个要点`)}
              </button>
            ) : (
              <button
                type="button"
                className="ui-action pi-chrome-label pi-bracket"
                disabled={summarizing}
                onClick={() => { onSummarize(videoId); setSummaryOpen(true); }}
                title={L("Reads the transcript and asks Robin's model for a summary. Uses tokens.", "读取字幕并让 Robin 的模型总结，会消耗 token。")}
              >
                {summarizing ? L("Reading transcript…", "正在读字幕…") : L("Summarize", "AI 总结")}
              </button>
            )}
          </div>
        </div>
      </div>
    </article>
  );
}

// ---------------------------------------------------------------------------

export function PodcastDirectory() {
  const { t, L, locale } = useText();
  // The feeds change every few hours; a slow poll is only there to notice a scan finishing.
  const resource = usePolledResource<Response>("/api/robin/podcasts", 120_000);
  const data = resource.data;
  const [shelf, setShelf] = useState<PodcastShelf | "all">("all");
  const [showAll, setShowAll] = useState(false);
  const [pending, setPending] = useState<Set<string>>(new Set());
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [refreshing, setRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState<string | null>(null);
  // One preference for every card, remembered per browser.
  const [summaryLang, setSummaryLangState] = useState<SummaryLang>("both");
  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(SUMMARY_LANG_KEY);
      if (stored === "both" || stored === "zh" || stored === "en") setSummaryLangState(stored);
    } catch {
      // Storage can be blocked; the default is fine.
    }
  }, []);
  const setSummaryLang = (next: SummaryLang) => {
    setSummaryLangState(next);
    try {
      window.localStorage.setItem(SUMMARY_LANG_KEY, next);
    } catch {
      // Not remembered, still applied.
    }
  };

  const details = useMemo(() => data?.details ?? {}, [data]);
  const summaries = useMemo(() => data?.summaries ?? {}, [data]);
  const latest = useMemo(() => data?.latest ?? [], [data]);
  const shelfCounts = useMemo(() => {
    const counts: Record<string, number> = { all: latest.length };
    for (const episode of latest) {
      const channel = channelById(episode.channelId);
      if (channel) counts[channel.shelf] = (counts[channel.shelf] ?? 0) + 1;
    }
    return counts;
  }, [latest]);
  const filtered = shelf === "all" ? latest : latest.filter((episode) => channelById(episode.channelId)?.shelf === shelf);
  const visible = showAll ? filtered : filtered.slice(0, LATEST_PAGE);

  const lastPublished = data?.lastPublished ?? {};

  const summarize = async (videoId: string) => {
    setPending((current) => new Set(current).add(videoId));
    setErrors((current) => {
      const next = { ...current };
      delete next[videoId];
      return next;
    });
    try {
      const response = await fetch("/api/robin/podcasts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "summarize", videoId }),
      });
      if (!response.ok) {
        const parsed = await response.json().catch(() => null) as { error?: string } | null;
        throw new Error(parsed?.error ?? `Request failed (${response.status})`);
      }
      await resource.refresh();
    } catch (caught) {
      setErrors((current) => ({ ...current, [videoId]: caught instanceof Error ? caught.message : String(caught) }));
    } finally {
      setPending((current) => {
        const next = new Set(current);
        next.delete(videoId);
        return next;
      });
    }
  };

  const refresh = async () => {
    setRefreshing(true);
    setRefreshError(null);
    try {
      const response = await fetch("/api/robin/podcasts", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "refresh" }) });
      if (!response.ok) {
        const parsed = await response.json().catch(() => null) as { error?: string } | null;
        throw new Error(parsed?.error ?? `Request failed (${response.status})`);
      }
      await resource.refresh();
    } catch (caught) {
      setRefreshError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setRefreshing(false);
    }
  };

  const busy = (videoId: string) => pending.has(videoId) || (data?.summarizing ?? []).includes(videoId);
  const scanning = refreshing || data?.scanning === true;
  const failures = data?.failures ?? [];

  const cardFor = (videoId: string, fallback: { title: string; show: string; published?: string; description: string }, note?: Localized) => {
    const detail = details[videoId];
    return (
      <EpisodeCard
        key={videoId}
        videoId={videoId}
        title={detail?.title ?? fallback.title}
        show={fallback.show}
        published={fallback.published}
        details={detail}
        description={detail?.description || fallback.description}
        note={note}
        summary={summaries[videoId]}
        summarizing={busy(videoId)}
        error={errors[videoId]}
        onSummarize={(id) => void summarize(id)}
        summaryLang={summaryLang}
        onSummaryLang={setSummaryLang}
      />
    );
  };

  const interviewCard = (person: string, interview: Interview) => cardFor(
    interview.videoId,
    { title: `${person} — ${interview.show}`, show: interview.show, description: "" },
    interview.note,
  );

  const feedCard = (episode: FeedEpisode) => cardFor(episode.videoId, {
    title: episode.title,
    show: channelById(episode.channelId)?.name ?? episode.channelId,
    published: episode.published,
    description: episode.description,
  });

  return (
    <div className={`robin-page robin-dashboard flex-1 overflow-y-auto ${styles.page}`} style={{ minHeight: 0 }}>
      <main className="mx-auto flex w-full max-w-7xl flex-col gap-10 p-4 desktop:p-6">
        <header className={styles.masthead}>
          <div className="flex min-w-0 flex-col gap-2">
            <span className="pi-eyebrow" style={{ color: "var(--accent)" }}>{L("Podcasts · listening shelf", "Podcasts · 收听书架")}</span>
            <h1 className="text-3xl" style={{ fontStyle: "italic", fontWeight: 400, color: "var(--text)" }}>
              {L("Worth the two hours", "值得花两小时听的")}
            </h1>
            <p className="max-w-3xl text-sm" style={{ color: "var(--text-muted)" }}>
              {L(
                `Long interviews with the people building AI and products, and what ${PODCAST_CHANNELS.length} channels published in the last three weeks. Descriptions are the creator's own; a summary is made from the transcript only when you ask for one.`,
                `做 AI 和产品的人的长访谈，以及 ${PODCAST_CHANNELS.length} 个频道近三周的新节目。简介来自创作者本人；AI 总结只在你点击时根据字幕生成。`,
              )}
            </p>
            <nav className={styles.jump} aria-label={L("On this page", "本页")}>
              <a href="#podcast-people">{L("People", "人物")} ↓</a>
              <a href="#podcast-latest">{L("Latest", "最新")} ↓</a>
              <a href="#podcast-channels">{L("Channels", "频道")} ↓</a>
            </nav>
          </div>
          <div className={styles.status}>
            <span className="pi-eyebrow" role="status">
              {scanning
                ? L("Checking feeds…", "正在检查频道…")
                : data?.scannedAt
                  ? L(`Feeds checked ${formatAgo(data.scannedAt, locale)}`, `频道更新于${formatAgo(data.scannedAt, locale)}`)
                  : resource.loading ? L("Loading…", "加载中…") : L("Feeds not checked yet", "尚未检查频道")}
              {failures.length > 0 && !scanning && (
                <span style={{ color: "var(--danger)" }} title={failures.map((item) => `${channelById(item.channelId)?.name ?? item.channelId}: ${item.error}`).join("\n")}>
                  {" · "}{L(`${failures.length} failed`, `${failures.length} 个失败`)}
                </span>
              )}
            </span>
            <button type="button" className="ui-action pi-chrome-label pi-bracket min-h-11" disabled={scanning} onClick={() => void refresh()}>
              {L("Refresh", "刷新")}
            </button>
          </div>
        </header>

        {(refreshError ?? (resource.error && !data ? resource.error : null)) && (
          <p role="alert" className={styles.error}>{refreshError ?? resource.error}</p>
        )}

        <section className="flex flex-col gap-4" aria-labelledby="podcast-people">
          <header className="flex flex-col gap-2">
            <h2 id="podcast-people" className="pi-label">{L("People", "人物访谈")}</h2>
            <p className="text-xs" style={{ color: "var(--text-muted)" }}>
              {L("The interviews to start with, by the person being interviewed.", "按受访者整理、最值得先听的访谈。")}
            </p>
          </header>
          <div className={styles.people}>
            {PODCAST_PEOPLE.map((person) => (
              <div key={person.name} className={styles.person}>
                <div className={styles.personHead}>
                  <h3 className={styles.personName}>{person.name}</h3>
                  <p className={styles.personRole}>{t(person.role)}</p>
                </div>
                <div className={styles.personEpisodes}>
                  {person.interviews.map((interview) => interviewCard(person.name, interview))}
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className="flex flex-col gap-4" aria-labelledby="podcast-latest">
          <header className="flex flex-col gap-2">
            <h2 id="podcast-latest" className="pi-label">{L("Latest", "最新节目")}</h2>
            <p className="text-xs" style={{ color: "var(--text-muted)" }}>
              {L("Full episodes from the last three weeks — clips and shorts left out, at most three per channel.", "近三周的完整节目——不含短片与切片，每个频道最多三期。")}
            </p>
          </header>
          <div className={styles.filters} role="group" aria-label={L("Filter by shelf", "按类别筛选")}>
            {(["all", ...PODCAST_SHELVES] as const).map((key) => (
              <button
                key={key}
                type="button"
                className="ui-action pi-eyebrow"
                data-active={shelf === key || undefined}
                aria-pressed={shelf === key}
                onClick={() => { setShelf(key); setShowAll(false); }}
              >
                {key === "all" ? L("All", "全部") : t(SHELF_LABEL[key])}
                <span className={styles.count}>{shelfCounts[key] ?? 0}</span>
              </button>
            ))}
          </div>
          {data && latest.length === 0 && (
            <p className={styles.empty}>{scanning ? L("Reading the channel feeds…", "正在读取频道…") : L("Nothing new in the last three weeks.", "近三周没有新节目。")}</p>
          )}
          <div className={styles.latest}>{visible.map(feedCard)}</div>
          {filtered.length > LATEST_PAGE && (
            <button type="button" className="ui-action pi-chrome-label pi-bracket self-start min-h-11" onClick={() => setShowAll((value) => !value)}>
              {showAll ? L("Show fewer", "收起") : L(`Show all ${filtered.length}`, `显示全部 ${filtered.length} 期`)}
            </button>
          )}
        </section>

        <section className="flex flex-col gap-4" aria-labelledby="podcast-channels">
          <header className="flex flex-col gap-2">
            <h2 id="podcast-channels" className="pi-label">{L("Channels", "频道")}</h2>
            <p className="text-xs" style={{ color: "var(--text-muted)" }}>
              {L("Every channel the shelf reads, and when it last published.", "本页读取的所有频道，以及最近一次更新。")}
            </p>
          </header>
          <div className={styles.directory}>
            {PODCAST_SHELVES.map((key) => (
              <div key={key} className={styles.shelf}>
                <h3 className="pi-eyebrow">{t(SHELF_LABEL[key])}</h3>
                <ul>
                  {PODCAST_CHANNELS.filter((channel) => channel.shelf === key).map((channel) => (
                    <li key={channel.id}>
                      <p className={styles.channelLine}>
                        <a href={`https://www.youtube.com/channel/${channel.youtubeId}`} target="_blank" rel="noopener noreferrer">{channel.name}</a>
                        <span className={styles.leader} aria-hidden="true" />
                        <time className={styles.channelDate} dateTime={lastPublished[channel.id]}>{lastSeen(lastPublished[channel.id], locale)}</time>
                      </p>
                      <p className={styles.channelHost}>{t(channel.host)}</p>
                      <p className={styles.channelWhy}>{t(channel.why)}</p>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </section>

        <footer className={styles.footnotes}>
          <div>
            <h2 className="pi-eyebrow">{L("Where to find the next one", "去哪里发现下一期")}</h2>
            <p className="text-xs" style={{ color: "var(--text-muted)" }}>
              {L("Recommendation threads are a ranking signal; the episode itself is the source.", "推荐帖是排序信号，节目本身才是信息源。")}
            </p>
            <ul className={styles.inlineLinks}>
              {DISCOVERY.map((item) => (
                <li key={item.url}><a href={item.url} target="_blank" rel="noopener noreferrer">{item.label} ↗</a></li>
              ))}
            </ul>
          </div>
          <div>
            <h2 className="pi-eyebrow">{L("How summaries work", "AI 总结如何生成")}</h2>
            <p className="text-xs" style={{ color: "var(--text-muted)" }}>
              {L(
                "Channel description first. On request, the page reads the episode's captions from YouTube, stamps each minute, and asks Robin's model for a TL;DR and key points in both English and Chinese, each linking back to the moment. One summary per episode, kept.",
                "默认显示频道简介。点击后读取 YouTube 字幕、按分钟打时间戳，再让 Robin 的模型生成中英双语的摘要和要点，每个要点都能跳转到对应时刻。每期只生成一次并保存。",
              )}
            </p>
            <ul className={styles.tools}>
              {TOOLS.map((tool) => (
                <li key={tool.url}>
                  <a href={tool.url} target="_blank" rel="noopener noreferrer">{tool.label} ↗</a>
                  <span>{t(tool.note)}</span>
                </li>
              ))}
            </ul>
          </div>
        </footer>
      </main>
    </div>
  );
}
