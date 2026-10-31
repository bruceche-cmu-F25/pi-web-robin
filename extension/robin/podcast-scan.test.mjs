import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";

const dir = mkdtempSync(join(tmpdir(), "robin-podcasts-"));
process.env.ROBIN_DATA_DIR = dir;
after(() => rmSync(dir, { recursive: true, force: true }));

const {
  PODCAST_SCAN_RUN,
  fetchTranscript,
  fetchVideoDetails,
  readPodcastStore,
  podcastSummaryRun,
  podcastScanRunning,
  scanPodcasts,
  startPodcastScan,
  summariesRunning,
  summarizeEpisode,
} = await import("./podcast-scan.ts");
const { claimBackgroundRun, releaseBackgroundRun, RUN_LEASE_MS } = await import("./background-run-domain.ts");

const feed = (id) => `<feed><entry><yt:videoId>${id}</yt:videoId><title>${id}</title>
  <link rel="alternate" href="https://www.youtube.com/watch?v=${id}"/>
  <published>2026-09-10T00:00:00+00:00</published><media:description>d</media:description></entry></feed>`;

test("feeds come from the long-form playlist, falling back to the channel feed", async () => {
  const requested = [];
  const fetchImpl = async (url, init) => {
    requested.push(url);
    if (init?.method === "POST") return new Response("{}", { status: 200 });
    if (url.includes("playlist_id=UULFaaaaaaaaaaaaaaaaaaaaaa")) return new Response(feed("longformAAA"), { status: 200 });
    if (url.includes("playlist_id=UULFbbbbbbbbbbbbbbbbbbbbbb")) return new Response("", { status: 404 });
    if (url.includes("channel_id=UCbbbbbbbbbbbbbbbbbbbbbb")) return new Response(feed("channelBBBB"), { status: 200 });
    return new Response("", { status: 500 });
  };
  const channels = [
    { id: "a", name: "A", youtubeId: "UCaaaaaaaaaaaaaaaaaaaaaa", shelf: "ai", host: { en: "", zh: "" }, why: { en: "", zh: "" } },
    { id: "b", name: "B", youtubeId: "UCbbbbbbbbbbbbbbbbbbbbbb", shelf: "ai", host: { en: "", zh: "" }, why: { en: "", zh: "" } },
  ];
  const store = await scanPodcasts({ fetchImpl, channels, now: Date.parse("2026-09-11T00:00:00Z") });
  assert.deepEqual(store.failures, []);
  assert.deepEqual(store.episodes.map((episode) => [episode.channelId, episode.videoId]), [["a", "longformAAA"], ["b", "channelBBBB"]]);
  assert.equal(requested.some((url) => url.includes("channel_id=UCaaaaaaaaaaaaaaaaaaaaaa")), false);
});

test("a channel whose feed fails keeps its last episodes; the others refresh", async () => {
  const channels = [
    { id: "a", name: "A", youtubeId: "UCaaaaaaaaaaaaaaaaaaaaaa", shelf: "ai", host: { en: "", zh: "" }, why: { en: "", zh: "" } },
    { id: "b", name: "B", youtubeId: "UCbbbbbbbbbbbbbbbbbbbbbb", shelf: "ai", host: { en: "", zh: "" }, why: { en: "", zh: "" } },
  ];
  const now = Date.parse("2026-09-11T00:00:00Z");
  const serve = (ids) => async (url, init) => {
    if (init?.method === "POST") return new Response("{}", { status: 200 });
    for (const [channel, id] of Object.entries(ids)) {
      if (url.includes(`UULF${channel.repeat(22)}`)) return id ? new Response(feed(id), { status: 200 }) : new Response("", { status: 500 });
    }
    return new Response("", { status: 500 });
  };
  await scanPodcasts({ fetchImpl: serve({ a: "firstAAAAAA", b: "firstBBBBBB" }), channels, now });
  const store = await scanPodcasts({ fetchImpl: serve({ a: "secondAAAAA", b: null }), channels, now });

  assert.deepEqual(store.failures.map((failure) => failure.channelId), ["b"]);
  assert.deepEqual(store.episodes.map((episode) => episode.videoId), ["secondAAAAA", "firstBBBBBB"]);
});

test("when every feed 404s, uploads come from the browse endpoint and reuse known details", async () => {
  const channels = [
    { id: "c", name: "C", youtubeId: "UCcccccccccccccccccccccc", shelf: "ai", host: { en: "", zh: "" }, why: { en: "", zh: "" } },
  ];
  const lockup = (id) => ({ lockupViewModel: { contentId: id, contentType: "LOCKUP_CONTENT_TYPE_VIDEO" } });
  const players = [];
  const fetchImpl = async (url, init) => {
    if (url.includes("/youtubei/v1/browse")) {
      assert.equal(JSON.parse(init.body).browseId, "VLUULFcccccccccccccccccccccc");
      return Response.json({ contents: { items: [lockup("newVideoCCC"), lockup("oldVideoCCC"), { lockupViewModel: { contentId: "PLnotavideo", contentType: "LOCKUP_CONTENT_TYPE_PLAYLIST" } }] } });
    }
    if (url.includes("/youtubei/v1/player")) {
      const { videoId } = JSON.parse(init.body);
      players.push(videoId);
      return Response.json({
        videoDetails: { title: `Title ${videoId}`, author: "C", lengthSeconds: "3600", shortDescription: "about" },
        microformat: { playerMicroformatRenderer: { publishDate: "2026-09-12T10:00:00-07:00" } },
      });
    }
    return new Response("", { status: 404 });
  };
  const now = Date.parse("2026-09-16T00:00:00Z");
  const first = await scanPodcasts({ fetchImpl, channels, now });
  assert.deepEqual(first.failures, []);
  assert.deepEqual(first.episodes.map((episode) => [episode.videoId, episode.title, episode.published]), [
    ["newVideoCCC", "Title newVideoCCC", "2026-09-12T10:00:00-07:00"],
    ["oldVideoCCC", "Title oldVideoCCC", "2026-09-12T10:00:00-07:00"],
  ]);
  assert.equal(first.details.newVideoCCC.lengthSeconds, 3600);

  players.length = 0;
  await scanPodcasts({ fetchImpl, channels, now });
  assert.deepEqual(players, [], "details the store already holds are not fetched again");
});

test("fallback channels share one 100-request / three-worker detail budget and retain partial data", async () => {
  const channels = Array.from({ length: 12 }, (_, i) => ({ id: `budget-${i}`,
    name: `Budget ${i}`, youtubeId: `UC${String(i).padStart(22, "0")}`, shelf: "ai", host: { en: "", zh: "" }, why: { en: "", zh: "" } }));
  let expanded = false, active = 0, peak = 0;
  const requested = [];
  const videoId = (c, i) => `budget${String(c).padStart(2, "0")}${String(i).padStart(3, "0")}`;
  const fetchImpl = async (url, init) => {
    if (url.includes("/browse")) {
      const channel = Number(JSON.parse(init.body).browseId.slice(6));
      return Response.json({ items: Array.from({ length: expanded ? 15 : 1 }, (_, i) => ({
        lockupViewModel: { contentId: videoId(channel, i), contentType: "LOCKUP_CONTENT_TYPE_VIDEO" },
      })) });
    }
    if (url.includes("/player")) {
      const { videoId } = JSON.parse(init.body);
      requested.push(videoId); active++; peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, 2));
      active--;
      return Response.json({ videoDetails: { title: videoId, lengthSeconds: "3600" },
        microformat: { playerMicroformatRenderer: { publishDate: "2026-09-12T00:00:00Z" } } });
    }
    return new Response("", { status: 404 });
  };
  const options = { channels, fetchImpl, now: Date.parse("2026-09-16T00:00:00Z") };
  await scanPodcasts(options);
  requested.length = 0; peak = 0; expanded = true;
  const partial = await scanPodcasts(options);
  assert.equal(requested.length, 100);
  assert.equal(new Set(requested).size, requested.length);
  assert.ok(peak <= 3, `peak detail concurrency ${peak}`);
  assert.ok(partial.failures.length > 0, "deferred work is not silently reported as complete");
  for (let i = 0; i < channels.length; i++) assert.equal(partial.episodes.filter((e) => e.channelId === channels[i].id && e.videoId === videoId(i, 0)).length, 1);
  requested.length = 0;
  const complete = await scanPodcasts(options);
  assert.ok(requested.length <= 100);
  assert.equal(complete.episodes.length, 180);
  assert.deepEqual(complete.failures, []);
});

test("an aborted scan cannot publish or launch another batch of details", async () => {
  const before = JSON.stringify(readPodcastStore());
  const controller = new AbortController();
  let players = 0;
  await assert.rejects(scanPodcasts({ channels: [{ id: "abort", youtubeId: "UCaaaaaaaaaaaaaaaaaaaaaa" }], signal: controller.signal,
    fetchImpl: async (url) => {
      if (url.includes("/player")) { players++; controller.abort(); return Response.json({}); }
      return new Response(feed("abortVideo1"));
    }, now: Date.parse("2026-09-11T00:00:00Z"),
  }), /abort/i);
  assert.ok(players <= 3);
  assert.equal(JSON.stringify(readPodcastStore()), before);
});

test("a rejected podcast commit does not fall through to an unfenced write", async () => {
  const before = JSON.stringify((await import("./podcast-scan.ts")).readPodcastStore());
  let commits = 0;
  await scanPodcasts({
    channels: [],
    now: Date.parse("2026-09-20T00:00:00Z"),
    commit: () => {
      commits += 1;
      return null;
    },
  });
  assert.equal(commits, 1);
  assert.equal(JSON.stringify((await import("./podcast-scan.ts")).readPodcastStore()), before);
});

test("a durable owner in another process blocks duplicate YouTube traffic", async () => {
  const owner = "another-runtime:podcast-scan";
  assert.equal(claimBackgroundRun(PODCAST_SCAN_RUN, owner), true);
  let requests = 0;
  try {
    await startPodcastScan({
      fetchImpl: async () => {
        requests += 1;
        throw new Error("should not fetch");
      },
    });
    assert.equal(requests, 0);
    assert.equal(podcastScanRunning(), true);
  } finally {
    releaseBackgroundRun(PODCAST_SCAN_RUN, owner);
  }
  assert.equal(podcastScanRunning(), false);
});

test("a remote episode summary blocks duplicate model and transcript work", async () => {
  const videoId = "remoteVid01";
  const runName = podcastSummaryRun(videoId);
  assert.equal(claimBackgroundRun(runName, "another-runtime"), true);
  let requests = 0;
  let asks = 0;
  try {
    await assert.rejects(
      summarizeEpisode(videoId, async () => { asks += 1; return ""; }, async () => {
        requests += 1;
        throw new Error("should not fetch");
      }),
      /already being summarised/,
    );
    assert.equal(requests, 0);
    assert.equal(asks, 0);
    assert.ok(summariesRunning().includes(videoId));
  } finally {
    releaseBackgroundRun(runName, "another-runtime");
  }
});

test("completed summaries are reused without another transcript or paid turn", async () => {
  const videoId = "cachedVid01";
  let requests = 0, asks = 0;
  const fetchImpl = async (url, init) => {
    requests++;
    assert.equal(init.redirect, "error", "YouTube replies cannot redirect to another host");
    return String(url).includes("/player")
      ? Response.json({ captions: { playerCaptionsTracklistRenderer: { captionTracks: [
        { baseUrl: `https://www.youtube.com/api/timedtext?v=${videoId}`, languageCode: "en" },
      ] } } })
      : new Response('<transcript><text start="0">test transcript</text></transcript>');
  };
  const ask = async () => { asks++; return JSON.stringify({
    tldr: { en: "Saved summary.", zh: "已存摘要。" },
    points: [{ at: "[0:00]", en: "Saved point.", zh: "已存要点。" }],
  }); };
  const first = await summarizeEpisode(videoId, ask, fetchImpl);
  const second = await summarizeEpisode(videoId, ask, fetchImpl);
  assert.deepEqual(second, first);
  assert.equal(requests, 2);
  assert.equal(asks, 1);
});

test("oversized network bodies are cancelled before parsing, including chunked replies", async () => {
  let cancelled = false;
  const oversized = () => new Response(new ReadableStream({
    pull(controller) { controller.enqueue(new Uint8Array(1024 * 1024)); },
    cancel() { cancelled = true; },
  }));
  await assert.rejects(fetchVideoDetails("oversize001", async () => oversized()), /response too large/);
  assert.equal(cancelled, true);
  await assert.rejects(fetchVideoDetails("oversize001", async () => new Response("", {
    headers: { "content-length": String(9 * 1024 * 1024) },
  })), /response too large/);
});

test("caption hosts are checked before a second network call", async () => {
  let requests = 0;
  await assert.rejects(fetchTranscript("badCaption1", async () => {
    requests++;
    return Response.json({ captions: { playerCaptionsTracklistRenderer: { captionTracks: [
      { baseUrl: "http://127.0.0.1/private", languageCode: "en" },
    ] } } });
  }), /Unexpected caption host/);
  assert.equal(requests, 1);
});

test("a replaced episode summarizer cannot publish its late model result", async () => {
  const videoId = "lateVideo01";
  const runName = podcastSummaryRun(videoId);
  let answer;
  const ask = () => new Promise((resolve) => { answer = resolve; });
  const fetchImpl = async (url) => String(url).includes("/player")
    ? Response.json({ captions: { playerCaptionsTracklistRenderer: { captionTracks: [
      { baseUrl: `https://www.youtube.com/api/timedtext?v=${videoId}`, languageCode: "en" },
    ] } } })
    : new Response('<transcript><text start="0">hello world</text></transcript>', { status: 200 });

  const pending = summarizeEpisode(videoId, ask, fetchImpl);
  while (!answer) await new Promise((resolve) => setImmediate(resolve));
  const replacementAt = Date.now() + RUN_LEASE_MS;
  assert.equal(claimBackgroundRun(runName, "replacement-owner", replacementAt), true);
  answer(JSON.stringify({
    tldr: { en: "A late summary.", zh: "迟到的总结。" },
    points: [{ at: "[0:00]", en: "Late point.", zh: "迟到的观点。" }],
  }));
  await assert.rejects(pending, /ownership was lost/);
  assert.equal((await import("./podcast-scan.ts")).readPodcastStore().summaries[videoId], undefined);
  assert.equal(releaseBackgroundRun(runName, "replacement-owner"), true);
});
