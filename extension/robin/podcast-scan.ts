/**
 * The network half of the listening shelf: channel feeds, per-video details,
 * transcripts, and the store they land in.
 *
 * A scan costs no model tokens — about thirty feed requests plus one small
 * player request for each video it has not seen before — but it still only
 * runs when asked (the page's refresh), never on a page load. Summaries
 * likewise run only on an explicit POST: a model reads a whole transcript.
 *
 * Transcripts use the approach of the open-source youtube-transcript-api
 * (MIT): ask YouTube's player endpoint as the Android client, whose caption
 * URLs work without a browser session. Ported rather than shelled out to so
 * Robin under launchd needs no Python on its PATH.
 *
 * Server-only: reaches node:fs through ./paths.ts.
 */
import {
  activeBackgroundRunNames,
  backgroundRunActive,
  claimBackgroundRun,
  heartbeatBackgroundRun,
  newBackgroundRunOwner,
  releaseBackgroundRun,
  withBackgroundRunOwnership,
} from "./background-run-domain.ts";
import { readJsonObject, updateJsonObject } from "./paths.ts";
import { startRunHeartbeat } from "./run-lease.ts";
import {
  EMPTY_PODCAST_STORE,
  INTERVIEW_IDS,
  LATEST_WINDOW_DAYS,
  PODCAST_CHANNELS,
  SUMMARY_INSTRUCTIONS,
  parseCaptionXml,
  parseBrowseVideoIds,
  parseSummaryReply,
  parseYouTubeFeed,
  transcriptWithTimestamps,
  type EpisodeSummary,
  type FeedEpisode,
  type PodcastChannel,
  type PodcastStore,
  type TranscriptSegment,
  type VideoDetails,
} from "./podcasts.ts";

const STORE_FILE = "podcasts.json";
const TIMEOUT_MS = 15_000;
const FEED_CONCURRENCY = 4;
const DETAIL_CONCURRENCY = 3;
/** New videos per scan that get a details request; the rest wait a scan. */
const DETAILS_PER_SCAN = 100;
/** ~90k tokens. A three-hour episode is about 180k characters, so this is ~6 hours — the page says so. */
const TRANSCRIPT_MAX_CHARS = 360_000;
const PLAYER_URL = "https://www.youtube.com/youtubei/v1/player";
const BROWSE_URL = "https://www.youtube.com/youtubei/v1/browse";
const WEB_CLIENT = { clientName: "WEB", clientVersion: "2.20250101.00.00", hl: "en", gl: "US" };

export function readPodcastStore(): PodcastStore {
  const stored = readJsonObject<Partial<PodcastStore>>(STORE_FILE);
  return { ...EMPTY_PODCAST_STORE, ...stored };
}

async function pooled<T, R>(items: T[], limit: number, worker: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const index = next;
      next += 1;
      if (index >= items.length) return;
      results[index] = await worker(items[index] as T);
    }
  }));
  return results;
}

async function request(
  fetchImpl: typeof fetch,
  url: string,
  body?: unknown,
  parentSignal?: AbortSignal,
): Promise<Response> {
  const timeout = AbortSignal.timeout(TIMEOUT_MS);
  const response = await fetchImpl(url, {
    signal: parentSignal ? AbortSignal.any([parentSignal, timeout]) : timeout,
    headers: {
      "Accept-Language": "en-US,en;q=0.9",
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    ...(body === undefined ? {} : { method: "POST", body: JSON.stringify(body) }),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response;
}

function player(
  fetchImpl: typeof fetch,
  videoId: string,
  client: { clientName: string; clientVersion: string },
  signal?: AbortSignal,
) {
  return request(fetchImpl, PLAYER_URL, { context: { client }, videoId }, signal)
    .then((response) => response.json() as Promise<Record<string, unknown>>);
}

/**
 * A feed only ever holds the latest 15 uploads, and on a channel like Starter
 * Story twelve of those are Shorts — the channel feed left it three episodes.
 * The channel's long-form playlist (UULF + the id after "UC") is the same 15
 * with Shorts already excluded. The channel feed stays as the fallback.
 */
async function fetchFeed(
  fetchImpl: typeof fetch,
  channel: PodcastChannel,
  details: Map<string, VideoDetails>,
  signal?: AbortSignal,
): Promise<FeedEpisode[]> {
  const longForm = `https://www.youtube.com/feeds/videos.xml?playlist_id=UULF${channel.youtubeId.slice(2)}`;
  try {
    const response = await request(fetchImpl, longForm, undefined, signal)
      .catch(() => request(fetchImpl, `https://www.youtube.com/feeds/videos.xml?channel_id=${channel.youtubeId}`, undefined, signal));
    return parseYouTubeFeed(await response.text(), channel.id);
  } catch (feedError) {
    const episodes = await fetchUploads(fetchImpl, channel, details, signal).catch(() => []);
    if (episodes.length === 0) throw feedError;
    return episodes;
  }
}

/**
 * The same long-form playlist, read the way youtube.com reads it, for when
 * the feeds are down. It lists ids only, so each video the store has not seen
 * costs one player request; those details are handed back to the scan.
 */
async function fetchUploads(
  fetchImpl: typeof fetch,
  channel: PodcastChannel,
  details: Map<string, VideoDetails>,
  signal?: AbortSignal,
): Promise<FeedEpisode[]> {
  const response = await request(fetchImpl, BROWSE_URL, {
    context: { client: WEB_CLIENT },
    browseId: `VLUULF${channel.youtubeId.slice(2)}`,
  }, signal);
  const ids = parseBrowseVideoIds(await response.json());
  const found = await pooled(ids, DETAIL_CONCURRENCY, async (id) => {
    const known = details.get(id) ?? await fetchVideoDetails(id, fetchImpl, signal).catch(() => null);
    if (known) details.set(id, known);
    return known;
  });
  return found.flatMap((video) => video?.published ? [{
    videoId: video.videoId,
    channelId: channel.id,
    title: video.title,
    published: video.published,
    description: video.description,
  }] : []);
}

/**
 * Title, length, publish date and full description. The WEB client answers
 * these even for videos it will not play, which is all we need from it.
 */
export async function fetchVideoDetails(
  videoId: string,
  fetchImpl: typeof fetch = fetch,
  signal?: AbortSignal,
): Promise<VideoDetails | null> {
  const data = await player(fetchImpl, videoId, WEB_CLIENT, signal);
  const video = data.videoDetails as Record<string, unknown> | undefined;
  if (!video || typeof video.title !== "string") return null;
  const micro = (data.microformat as { playerMicroformatRenderer?: { publishDate?: unknown } } | undefined)?.playerMicroformatRenderer;
  return {
    videoId,
    title: video.title,
    author: typeof video.author === "string" ? video.author : "",
    lengthSeconds: Number(video.lengthSeconds) || 0,
    ...(typeof micro?.publishDate === "string" ? { published: micro.publishDate } : {}),
    description: typeof video.shortDescription === "string" ? video.shortDescription : "",
  };
}

export async function fetchTranscript(
  videoId: string,
  fetchImpl: typeof fetch = fetch,
  signal?: AbortSignal,
): Promise<TranscriptSegment[]> {
  const data = await player(fetchImpl, videoId, { clientName: "ANDROID", clientVersion: "20.10.38" }, signal);
  const status = (data.playabilityStatus as { status?: string; reason?: string } | undefined);
  if (status?.status && status.status !== "OK") throw new Error(status.reason || `YouTube says ${status.status}`);
  const tracks = ((data.captions as { playerCaptionsTracklistRenderer?: { captionTracks?: unknown } } | undefined)
    ?.playerCaptionsTracklistRenderer?.captionTracks ?? []) as Array<{ baseUrl?: string; languageCode?: string; kind?: string }>;
  const english = tracks.filter((track) => track.languageCode?.startsWith("en"));
  const track = english.find((item) => item.kind !== "asr") ?? english[0] ?? tracks[0];
  if (!track?.baseUrl) throw new Error("This video has no captions to summarise.");
  const url = new URL(track.baseUrl);
  // The URL comes out of YouTube's response; still refuse to follow it anywhere else.
  if (url.protocol !== "https:" || !/(^|\.)youtube\.com$/.test(url.hostname)) throw new Error("Unexpected caption host");
  url.searchParams.delete("fmt");
  const response = await request(fetchImpl, url.toString(), undefined, signal);
  return parseCaptionXml(await response.text());
}

// ---------------------------------------------------------------------------
// Scan

let running: Promise<void> | null = null;
export const PODCAST_SCAN_RUN = "podcast-scan";

export function podcastScanRunning(): boolean {
  return backgroundRunActive(PODCAST_SCAN_RUN);
}

/** Start a scan unless one is already going. Never rejects. */
export function startPodcastScan(options: PodcastScanOptions = {}): Promise<void> {
  if (running) return running;
  const ownerId = newBackgroundRunOwner();
  if (!claimBackgroundRun(PODCAST_SCAN_RUN, ownerId)) return Promise.resolve();

  const controller = new AbortController();
  const heartbeat = startRunHeartbeat(
    () => heartbeatBackgroundRun(PODCAST_SCAN_RUN, ownerId),
    controller,
  );
  running = scanPodcasts({
    ...options,
    signal: options.signal
      ? AbortSignal.any([options.signal, controller.signal])
      : controller.signal,
    commit: (write) => {
      const result = withBackgroundRunOwnership(PODCAST_SCAN_RUN, ownerId, write);
      return result.owned ? result.value : null;
    },
  })
    .then(() => undefined)
    .catch((error: unknown) => {
      if (!controller.signal.aborted) {
        console.error("[robin] podcast scan failed:", error instanceof Error ? error.message : error);
      }
    })
    .finally(() => {
      clearInterval(heartbeat);
      releaseBackgroundRun(PODCAST_SCAN_RUN, ownerId);
      running = null;
    });
  return running;
}

export interface PodcastScanOptions {
  fetchImpl?: typeof fetch;
  now?: number;
  channels?: PodcastChannel[];
  signal?: AbortSignal;
  /** Transaction seam used by the durable runner to fence the final write. */
  commit?: (write: () => PodcastStore) => PodcastStore | null;
}

export async function scanPodcasts(options: PodcastScanOptions = {}): Promise<PodcastStore> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const now = options.now ?? Date.now();
  const channels = options.channels ?? PODCAST_CHANNELS;

  const failures: PodcastStore["failures"] = [];
  const known = readPodcastStore().details;
  // Seeded with what the store knows; the browse fallback adds what it fetched.
  const seen = new Map(Object.entries(known));
  const feeds = await pooled(channels, FEED_CONCURRENCY, async (channel) => {
    try {
      return await fetchFeed(fetchImpl, channel, seen, options.signal);
    } catch (error) {
      failures.push({ channelId: channel.id, error: error instanceof Error ? error.message : String(error) });
      return [];
    }
  });
  const episodes = feeds.flat();

  const since = now - LATEST_WINDOW_DAYS * 86_400_000;
  const wanted = [
    ...INTERVIEW_IDS,
    ...episodes.filter((episode) => Date.parse(episode.published) >= since).map((episode) => episode.videoId),
  ].filter((id, index, all) => !seen.has(id) && all.indexOf(id) === index).slice(0, DETAILS_PER_SCAN);
  const fetched = await pooled(wanted, DETAIL_CONCURRENCY, (id) => fetchVideoDetails(id, fetchImpl, options.signal).catch(() => null));

  const write = () => updateJsonObject<PodcastStore, PodcastStore>(STORE_FILE, (current) => {
    const base = { ...EMPTY_PODCAST_STORE, ...current };
    // A feed that failed is not a channel that went quiet: keep what it had,
    // whether one channel timed out or the whole machine is offline.
    const failed = new Set(failures.map((failure) => failure.channelId));
    const keptEpisodes = [...episodes, ...base.episodes.filter((episode) => failed.has(episode.channelId))];
    const details: Record<string, VideoDetails> = { ...base.details };
    for (const [id, item] of seen) if (!known[id]) details[id] = item;
    for (const item of fetched) if (item) details[item.videoId] = item;
    const live = new Set([...INTERVIEW_IDS, ...keptEpisodes.map((episode) => episode.videoId), ...Object.keys(base.summaries)]);
    for (const id of Object.keys(details)) if (!live.has(id)) delete details[id];
    const value: PodcastStore = {
      ...base,
      scannedAt: new Date(now).toISOString(),
      failures,
      episodes: keptEpisodes,
      details,
    };
    return { result: value, value, changed: true };
  });
  if (!options.commit) return write();
  return options.commit(write) ?? readPodcastStore();
}

// ---------------------------------------------------------------------------
// Summaries

const inflight = new Map<string, Promise<EpisodeSummary>>();
export const PODCAST_SUMMARY_PREFIX = "podcast-summary:";

export function podcastSummaryRun(videoId: string): string {
  return `${PODCAST_SUMMARY_PREFIX}${videoId}`;
}

export function summariesRunning(): string[] {
  return [...new Set([
    ...inflight.keys(),
    ...activeBackgroundRunNames(PODCAST_SUMMARY_PREFIX).map((name) => name.slice(PODCAST_SUMMARY_PREFIX.length)),
  ])];
}

/**
 * Read the transcript, hand it to `ask` (one model turn), keep the result.
 * A second click on the same episode joins the first run instead of paying
 * for another.
 */
export function summarizeEpisode(
  videoId: string,
  ask: (instructions: string, transcript: string, signal?: AbortSignal) => Promise<string>,
  fetchImpl: typeof fetch = fetch,
): Promise<EpisodeSummary> {
  const existing = inflight.get(videoId);
  if (existing) return existing;
  const runName = podcastSummaryRun(videoId);
  const ownerId = newBackgroundRunOwner();
  if (!claimBackgroundRun(runName, ownerId)) {
    return Promise.reject(new Error("This episode is already being summarised."));
  }
  const controller = new AbortController();
  const heartbeat = startRunHeartbeat(
    () => heartbeatBackgroundRun(runName, ownerId),
    controller,
  );
  const run = (async () => {
    const segments = await fetchTranscript(videoId, fetchImpl, controller.signal);
    if (segments.length === 0) throw new Error("The transcript came back empty.");
    const { text, truncated } = transcriptWithTimestamps(segments, TRANSCRIPT_MAX_CHARS);
    const reply = await ask(SUMMARY_INSTRUCTIONS, text, controller.signal);
    const summary = parseSummaryReply(reply, videoId, truncated);
    if (!summary) throw new Error("The model's summary could not be read. Try again.");
    const published = withBackgroundRunOwnership(runName, ownerId, () => {
      updateJsonObject<PodcastStore, null>(STORE_FILE, (current) => {
        const base = { ...EMPTY_PODCAST_STORE, ...current };
        return { result: null, value: { ...base, summaries: { ...base.summaries, [videoId]: summary } }, changed: true };
      });
    });
    if (!published.owned) throw new Error("Episode summary ownership was lost before its final write.");
    return summary;
  })().finally(() => {
    clearInterval(heartbeat);
    releaseBackgroundRun(runName, ownerId);
    inflight.delete(videoId);
  });
  inflight.set(videoId, run);
  return run;
}
