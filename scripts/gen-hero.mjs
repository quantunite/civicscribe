// Generate a hero image with Google's Gemini image model ("Nano Banana").
// Usage:  node scripts/gen-hero.mjs "<prompt>" <out.png>
// Reads GOOGLE_API_KEY (and optional GEMINI_IMAGE_MODEL) from the environment
// or a local .env. Writes a PNG. One-off asset tool, not part of the app.

import { writeFile, mkdir } from "node:fs/promises";
import { readFileSync, existsSync } from "node:fs";
import { dirname } from "node:path";

function loadDotEnv() {
  if (!existsSync(".env")) return;
  for (const raw of readFileSync(".env", "utf8").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    const k = line.slice(0, eq).trim();
    const v = line.slice(eq + 1).trim();
    if (k && !process.env[k]) process.env[k] = v;
  }
}

loadDotEnv();

const KEY = process.env.GOOGLE_API_KEY;
const MODEL = process.env.GEMINI_IMAGE_MODEL || "gemini-2.5-flash-image";
const [, , prompt, out] = process.argv;

if (!KEY) {
  console.error("GOOGLE_API_KEY is not set (paste it into .env). Aborting.");
  process.exit(1);
}
if (!prompt || !out) {
  console.error('usage: node scripts/gen-hero.mjs "<prompt>" <out.png>');
  process.exit(1);
}

const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${KEY}`;
const res = await fetch(url, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: { responseModalities: ["IMAGE"] },
  }),
});

if (!res.ok) {
  console.error(`HTTP ${res.status}:`, (await res.text()).slice(0, 800));
  process.exit(1);
}

const data = await res.json();
const parts = data?.candidates?.[0]?.content?.parts ?? [];
const b64 =
  parts.find((p) => p.inlineData?.data)?.inlineData?.data ??
  parts.find((p) => p.inline_data?.data)?.inline_data?.data;

if (!b64) {
  console.error("No image in response:", JSON.stringify(data).slice(0, 800));
  process.exit(1);
}

await mkdir(dirname(out), { recursive: true });
await writeFile(out, Buffer.from(b64, "base64"));
console.log("wrote", out);
