import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";

const dir = mkdtempSync(join(tmpdir(), "robin-podcasts-"));
process.env.ROBIN_DATA_DIR = dir;
after(() => rmSync(dir, { recursive: true, force: true }));

const { scanPodcasts } = await import("./podcast-scan.ts");

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
