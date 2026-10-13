#!/usr/bin/env node
// Keep Excalidraw's fonts local; the published package already ships public/.
import { cpSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
const root = resolve(import.meta.dirname, "..");
const target = resolve(root, "public/excalidraw");
mkdirSync(target, { recursive: true });
cpSync(resolve(root, "node_modules/@excalidraw/excalidraw/dist/prod/fonts"), resolve(target, "fonts"), { recursive: true });
