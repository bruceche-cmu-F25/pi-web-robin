import assert from "node:assert/strict";
import test from "node:test";
import {
  INTERVIEW_IDS,
  PODCAST_CHANNELS,
  PODCAST_PEOPLE,
  describeEpisode,
  isPodcastScanDue,
  latestEpisodes,
  parseCaptionXml,
  parseSummaryReply,
  parseYouTubeFeed,
  podcastView,
  transcriptWithTimestamps,
  watchUrl,
} from "./podcasts.ts";

const FEED = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns:yt="http://www.youtube.com/xml/schemas/2015" xmlns:media="http://search.yahoo.com/mrss/" xmlns="http://www.w3.org/2005/Atom">
 <title>Starter Story</title>
 <entry>
  <yt:videoId>vcVNj0kqP_o</yt:videoId>
  <title>A short</title>
  <link rel="alternate" href="https://www.youtube.com/shorts/vcVNj0kqP_o"/>
  <published>2026-09-11T19:39:02+00:00</published>
  <media:group><media:description>clip</media:description></media:group>
 </entry>
 <entry>
  <yt:videoId>abcdefghijk</yt:videoId>
  <title>He built a $1M app &amp; sold it</title>
  <link rel="alternate" href="https://www.youtube.com/watch?v=abcdefghijk"/>
  <published>2026-09-10T12:00:00+00:00</published>
  <media:group>
   <media:description>Line one &amp; two.

Second paragraph.</media:description>
   <media:community><media:statistics views="1234"/></media:community>
  </media:group>
 </entry>
</feed>`;

test("feed parsing keeps full episodes, drops shorts, decodes entities", () => {
  const episodes = parseYouTubeFeed(FEED, "starter-story");
  assert.equal(episodes.length, 1);
  assert.deepEqual(episodes[0], {
    videoId: "abcdefghijk",
    channelId: "starter-story",
    title: "He built a $1M app & sold it",
    published: "2026-09-10T12:00:00+00:00",
    description: "Line one & two.\n\nSecond paragraph.",
    views: 1234,
  });
});

test("descriptions split into the creator's lead and a chapter list", () => {
  const lex = [
    "Grant Sanderson is the creator of 3Blue1Brown.",
    "",
    "Support this podcast by supporting our sponsors:",
    "- Cash App: download app & use code \"LexPodcast\"",
    "",
    "EPISODE LINKS:",
    "3Blue1Brown: http://youtube.com/3blue1brown",
    "",
    "OUTLINE:",
    "0:00 - Introduction",
    "1:56 - Intuition and learning",
    "(12:30) Manim",
  ].join("\n");
  const { lead, chapters } = describeEpisode(lex);
  assert.equal(lead, "Grant Sanderson is the creator of 3Blue1Brown.");
  assert.deepEqual(chapters, [
    { seconds: 0, label: "Introduction" },
    { seconds: 116, label: "Intuition and learning" },
    { seconds: 750, label: "Manim" },
  ]);

  const dwarkesh = "Andrej explains why agents will take a decade.\n\nhttps://example.com/transcript\n\n𝐓𝐈𝐌𝐄𝐒𝐓𝐀𝐌𝐏𝐒\n(00:00:00) – AGI is still a decade away\n(00:29:45) – LLM cognitive deficits\n(01:40:05) – Evolution";
  const parsed = describeEpisode(dwarkesh);
  assert.equal(parsed.lead.startsWith("Andrej explains why agents will take a decade."), true);
  assert.equal(parsed.lead.includes("https://"), false);
  assert.deepEqual(parsed.chapters.map((chapter) => chapter.seconds), [0, 1785, 6005]);
  assert.equal(parsed.chapters[0].label, "AGI is still a decade away");

  // One timestamp in prose is a mention, not a chapter list.
  assert.deepEqual(describeEpisode("At 12:30 he explains it.\nMore.").chapters, []);
});

test("latest episodes: recent, not clips, at most three per channel", () => {
  const now = Date.parse("2026-09-11T00:00:00Z");
  const make = (id, channelId, daysAgo) => ({
    videoId: id.padEnd(11, "x"), channelId, title: id, description: "",
    published: new Date(now - daysAgo * 86_400_000).toISOString(),
  });
  const episodes = [make("a1", "yc", 1), make("a2", "yc", 2), make("a3", "yc", 3), make("a4", "yc", 4), make("b1", "lenny", 0.5), make("old", "lenny", 40), make("clip", "openai", 1)];
  const details = { [episodes[6].videoId]: { lengthSeconds: 120 } };
  const ids = latestEpisodes(episodes, details, now).map((episode) => episode.title);
  assert.deepEqual(ids, ["b1", "a1", "a2", "a3"]);
});

test("scan is due after six hours or when never run", () => {
  const now = Date.parse("2026-09-11T12:00:00Z");
  assert.equal(isPodcastScanDue({ scannedAt: null }, now), true);
  assert.equal(isPodcastScanDue({ scannedAt: "2026-09-11T07:00:00Z" }, now), false);
  assert.equal(isPodcastScanDue({ scannedAt: "2026-09-11T05:59:00Z" }, now), true);
});

test("captions become minute-stamped paragraphs and respect the budget", () => {
  const xml = `<transcript><text start="0.5" dur="2">he&amp;#39;s here</text><text start="30" dur="2">and &lt;b&gt;more</text><text start="61" dur="2">next minute</text><text start="95" dur="2">end</text></transcript>`;
  const segments = parseCaptionXml(xml);
  assert.deepEqual(segments[0], { start: 0.5, text: "he's here" });
  assert.equal(segments[1].text, "and more");
  const full = transcriptWithTimestamps(segments, 10_000);
  assert.equal(full.truncated, false);
  assert.equal(full.text, "[0:00] he's here and more next minute\n[1:35] end");
  const cut = transcriptWithTimestamps(segments, 45);
  assert.equal(cut.truncated, true);
  assert.equal(cut.text, "[0:00] he's here and more next minute");
});

test("summary replies are validated before they are stored", () => {
  const reply = "Here you go:\n{\"tldr\":{\"en\":\"Agents take a decade.\",\"zh\":\"Agent 需要十年。\"},\"points\":[{\"at\":\"[1:02:03]\",\"en\":\"RL is noisy.\",\"zh\":\"RL 噪声很大。\"},{\"at\":\"bogus\",\"en\":\"No time.\"},{\"en\":\"\"}]}";
  const summary = parseSummaryReply(reply, "lXUZvyajciY", false, new Date("2026-09-11T00:00:00Z"));
  assert.deepEqual(summary.points, [
    { at: 3723, en: "RL is noisy.", zh: "RL 噪声很大。" },
    { at: null, en: "No time.", zh: "No time." },
  ]);
  assert.equal(summary.tldr.zh, "Agent 需要十年。");
  assert.equal(parseSummaryReply("not json", "x", false), null);
  assert.equal(parseSummaryReply("{\"tldr\":{\"en\":\"x\"},\"points\":[]}", "x", false), null);
  assert.equal(watchUrl("lXUZvyajciY", 3723.4), "https://www.youtube.com/watch?v=lXUZvyajciY&t=3723s");
});

test("catalog ids are unique and well-formed", () => {
  const channelIds = PODCAST_CHANNELS.map((channel) => channel.id);
  assert.equal(new Set(channelIds).size, channelIds.length);
  for (const channel of PODCAST_CHANNELS) assert.match(channel.youtubeId, /^UC[\w-]{22}$/, channel.name);
  const videoIds = PODCAST_PEOPLE.flatMap((person) => person.interviews.map((item) => item.videoId));
  assert.equal(INTERVIEW_IDS.size, videoIds.length);
  for (const id of videoIds) assert.match(id, /^[\w-]{11}$/);
});

test("the page view carries only what it renders", () => {
  const now = Date.parse("2026-09-11T00:00:00Z");
  const interview = [...INTERVIEW_IDS][0];
  const fresh = { videoId: "freshfreshx", channelId: "yc", title: "new", description: "feed text", published: "2026-09-10T00:00:00Z" };
  const stale = { videoId: "stalestalex", channelId: "yc", title: "old", description: "x".repeat(5000), published: "2026-06-01T00:00:00Z" };
  const view = podcastView({
    scannedAt: "2026-09-10T20:00:00Z",
    failures: [],
    episodes: [fresh, stale],
    details: {
      [interview]: { videoId: interview, title: "t", author: "a", lengthSeconds: 3600, description: "keep me" },
      freshfreshx: { videoId: "freshfreshx", title: "new", author: "yc", lengthSeconds: 1800, description: "feed text" },
      stalestalex: { videoId: "stalestalex", title: "old", author: "yc", lengthSeconds: 1800, description: "gone" },
    },
    summaries: { stalestalex: { videoId: "stalestalex" } },
  }, now);
  assert.deepEqual(view.latest.map((episode) => episode.videoId), ["freshfreshx"]);
  assert.deepEqual(Object.keys(view.details).sort(), [interview, "freshfreshx"].sort());
  assert.equal(view.details[interview].description, "keep me");
  assert.equal(view.details.freshfreshx.description, "");
  assert.deepEqual(view.summaries, {});
  assert.equal(view.lastPublished.yc, "2026-09-10T00:00:00Z");
});

test("an out-of-range numeric entity is left as written instead of failing the feed", async () => {
  const { decodeEntities } = await import("./podcasts.ts");
  assert.equal(decodeEntities("a &#99999999; b &#x1F600; &amp;"), "a &#99999999; b 😀 &");
});
