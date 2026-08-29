import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("./SettingsPanel.tsx", import.meta.url), "utf8");
const en = await readFile(new URL("../../lib/i18n/messages/en.ts", import.meta.url), "utf8");
const zhCN = await readFile(new URL("../../lib/i18n/messages/zh-CN.ts", import.meta.url), "utf8");
const zhTW = await readFile(new URL("../../lib/i18n/messages/zh-TW.ts", import.meta.url), "utf8");

test("Daily settings includes the app language switch", () => {
  assert.match(source, /const \{ locale, setLocale, supportedLocales, t \} = useI18n\(\)/);
  assert.match(source, /supportedLocales\.map\(\(plugin\) =>/);
  assert.match(source, /onClick=\{\(\) => setLocale\(plugin\.id as typeof locale\)\}/);
  assert.match(source, /role="radiogroup" aria-label=\{t\("common\.language"\)\}/);
  assert.match(source, /aria-checked=\{selected\}/);
});

test("Daily settings language copy exists in every built-in locale", () => {
  for (const messages of [en, zhCN, zhTW]) {
    assert.match(messages, /"common\.language":/);
    assert.match(messages, /"settings\.languageDescription":/);
  }
});
