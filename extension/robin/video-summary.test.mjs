import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { videoIdFromUrl, videoSummaryMarkdown } from "./video-summary.ts";
const root = mkdtempSync(join(tmpdir(), "video-summary-"));
process.env.ROBIN_DATA_DIR = root;
after(() => rmSync(root, { recursive: true, force: true }));
const { summarizeVideoUrl, videoSummaryHistory, readPodcastStore } = await import("./podcast-scan.ts");
const id = "67BmkptgTms";
const url = `https://www.youtube.com/watch?v=${id}`;
const reply = JSON.stringify({ tldr: { en: "Synthetic summary", zh: "测试摘要" }, points: [
  { at: "0:00", en: "First idea", zh: "第一个观点" },
  { at: "9:59", en: "Invented timestamp", zh: "模型虚构的时间戳" },
] });
function network({ captions = '<text start="0">Hello world</text>', noTracks = false, noDetails = false } = {}) {
  const calls = [];
  return { calls, fetchImpl: async (url, init) => {
    calls.push(String(url));
    assert.equal(init.redirect, "error");
    if (String(url).includes("/player")) {
      const body = JSON.parse(init.body);
      if (body.context.client.clientName === "WEB") return Response.json(noDetails ? {} : { videoDetails: { title: "Synthetic test video", author: "Test creator", lengthSeconds: "600" } });
      return Response.json({ captions: { playerCaptionsTracklistRenderer: { captionTracks: noTracks ? [] : [{ baseUrl: "https://www.youtube.com/api/timedtext?v=test", languageCode: "en" }] } } });
    }
    return new Response(`<transcript>${captions}</transcript>`);
  } };
}

test("strict YouTube URL parsing accepts share/watch/shorts/live/embed and rejects arbitrary hosts", () => {
  for (const link of [url, `https://youtu.be/${id}?si=ignored`, `https://m.youtube.com/watch?v=${id}&t=30`, ...["shorts", "live", "embed"].map(path => `https://youtube.com/${path}/${id}`)]) assert.equal(videoIdFromUrl(link), id);
  for (const link of [null, id, "http://youtube.com/watch?v=" + id, "https://youtube.com.evil.test/watch?v=" + id, "https://127.0.0.1/watch?v=" + id, "https://youtube.com@evil.test/watch?v=" + id, "https://user@youtube.com/watch?v=" + id, "https://youtu.be/", "https://youtube.com/playlist?list=foo", "https://youtube.com:999/watch?v=" + id]) assert.throws(() => videoIdFromUrl(link));
});

test("full pipeline publishes metadata+summary, real stages, timestamp locators and reuses completed work", async () => {
  const net = network(), stages = [];
  let asks = 0;
  const ask = async (instructions, transcript) => {
    asks++;
    assert.match(instructions, /untrusted data/);
    assert.match(transcript, /Synthetic test video/);
    assert.match(transcript, /\[0:00\] Hello world/);
    return reply;
  };
  assert.deepEqual(videoSummaryHistory(), []);
  const result = await summarizeVideoUrl(url, ask, { ...net, onStage: stage => stages.push(stage) });
  assert.deepEqual(stages, ["details", "captions", "summarizing", "saving"]);
  assert.equal(result.details.title, "Synthetic test video");
  assert.equal(result.summary.points[0].at, 0);
  assert.equal(result.summary.points[1].at, null, "never publish invented timestamps");
  assert.equal(videoSummaryHistory()[0].summary.videoId, id);
  const cached = await summarizeVideoUrl(url, ask, net);
  assert.deepEqual(cached, result);
  assert.equal(net.calls.length, 3);
  assert.equal(asks, 1);
  const markdown = videoSummaryMarkdown(result, "zh");
  assert.match(markdown, /测试摘要/);
  assert.match(markdown, /未分析画面/);
  assert.match(markdown, /\[0:00\]\(https:\/\/www.youtube.com\/watch\?v=67BmkptgTms\)/);
});

test("missing/unavailable/empty captions and oversized transcripts never trigger AI or publish", async () => {
  let asks = 0;
  const ask = async () => { asks++; return reply; };
  for (const [videoId, options, message] of [
    ["noDetails01", { noDetails: true }, /Video unavailable/],
    ["noCaptions1", { noTracks: true }, /no captions/],
    ["emptyText01", { captions: "" }, /empty/],
    ["longVideo01", { captions: `<text start="0">${"word ".repeat(73_000)}</text>` }, /360,000/],
  ]) {
    await assert.rejects(summarizeVideoUrl(`https://youtu.be/${videoId}`, ask, network(options)), message);
    assert.equal(readPodcastStore().summaries[videoId], undefined);
    assert.equal(readPodcastStore().details[videoId], undefined);
  }
  assert.equal(asks, 0);
});

test("malformed model replies leave no completed record and a repeated request joins in-flight work", async () => {
  const videoId = "invalidAI01", net = network();
  await assert.rejects(summarizeVideoUrl(`https://youtu.be/${videoId}`, async () => "not JSON", net), /could not be read/);
  assert.equal(readPodcastStore().summaries[videoId], undefined);
  let answer, asks = 0;
  const ask = () => { asks++; return new Promise(resolve => { answer = resolve; }); };
  const a = summarizeVideoUrl(`https://youtu.be/${videoId}`, ask, net);
  while (!answer) await new Promise(resolve => setImmediate(resolve));
  const b = summarizeVideoUrl(`https://youtu.be/${videoId}`, ask, net);
  answer(reply);
  assert.deepEqual(await a, await b);
  assert.equal(asks, 1);
});
