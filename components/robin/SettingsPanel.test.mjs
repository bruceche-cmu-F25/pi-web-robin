import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("./SettingsPanel.tsx", import.meta.url), "utf8");
const themePicker = await readFile(new URL("../ThemePicker.tsx", import.meta.url), "utf8");
const en = await readFile(new URL("../../lib/i18n/messages/en.ts", import.meta.url), "utf8");
const zhCN = await readFile(new URL("../../lib/i18n/messages/zh-CN.ts", import.meta.url), "utf8");

test("Daily settings includes the app theme selector", () => {
  assert.match(source, /import \{ ThemePicker \} from "\.\.\/ThemePicker"/);
  assert.match(source, /<ThemePicker \/>/);
  assert.match(themePicker, /role="radiogroup" aria-label=\{t\("settings\.appearance"\)\}/);
  for (const preference of ["light", "dark", "auto"]) {
    assert.match(themePicker, new RegExp(`id: "${preference}"`));
  }
  assert.match(themePicker, /setThemePreference\(option\.id\)/);
});

test("Daily settings includes the app language switch", () => {
  assert.match(source, /const \{ locale, setLocale, supportedLocales, t \} = useI18n\(\)/);
  assert.match(source, /supportedLocales\.map\(\(plugin\) =>/);
  assert.match(source, /onClick=\{\(\) => setLocale\(plugin\.id as typeof locale\)\}/);
  assert.match(source, /role="radiogroup" aria-label=\{t\("common\.language"\)\}/);
  assert.match(source, /aria-checked=\{selected\}/);
});

test("Daily appearance and language copy exists in every built-in locale", () => {
  for (const messages of [en, zhCN]) {
    assert.match(messages, /"settings\.appearance":/);
    assert.match(messages, /"settings\.appearanceDescription":/);
    assert.match(messages, /"settings\.themeLight":/);
    assert.match(messages, /"settings\.themeDark":/);
    assert.match(messages, /"settings\.themeSystem":/);
    assert.match(messages, /"common\.language":/);
    assert.match(messages, /"settings\.languageDescription":/);
  }
});
