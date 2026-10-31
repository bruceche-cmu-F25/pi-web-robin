import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("./PodcastDirectory.tsx", import.meta.url), "utf8");
const navigation = await readFile(new URL("./RobinMargin.tsx", import.meta.url), "utf8");
const page = await readFile(new URL("../../app/podcasts/page.tsx", import.meta.url), "utf8");
const inbox = await readFile(new URL("./InformationInbox.tsx", import.meta.url), "utf8");
const route = await readFile(new URL("../../app/api/robin/podcasts/route.ts", import.meta.url), "utf8");

test("podcasts lives in Incoming and old bookmarks redirect with their context", () => {
  assert.doesNotMatch(navigation, /path: "\/podcasts"/);
  assert.match(inbox, /<PodcastDirectory active=\{source === "podcasts"\}/);
  assert.match(page, /params\.set\("feed", "podcasts"\)/);
  assert.match(page, /Object\.entries\(await searchParams\)/);
  assert.match(page, /redirect\(`/);
  assert.match(source, /usePolledResource<Response>\("\/api\/robin\/podcasts", 120_000, active\)/);
});

test("cards show the creator's description and open the original safely", () => {
  assert.match(source, /describeEpisode\(description\)/);
  assert.match(source, /target="_blank" rel="noopener noreferrer"/);
  // Chapters and summary points both deep-link to the moment in the episode.
  assert.match(source, /watchUrl\(videoId, chapter\.seconds\)/);
  assert.match(source, /watchUrl\(videoId, point\.at\)/);
});

test("summaries spend tokens only on an explicit POST for a video on the shelf", () => {
  assert.match(source, /action: "summarize", videoId/);
  assert.doesNotMatch(route.slice(route.indexOf("export const GET"), route.indexOf("export const POST")), /summarizeEpisode/);
  assert.match(route, /That video is not on the shelf/);
  assert.match(route, /toolNames: \[\]/);
});
