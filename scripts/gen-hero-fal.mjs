// Generate a hero image via fal.ai (default: FLUX Pro 1.1 Ultra, great for
// cinematic photoreal). Usage:
//   FAL_KEY=... node scripts/gen-hero-fal.mjs "<prompt>" <out.(jpg|png)>
// One-off asset tool, not part of the app. Reads FAL_KEY from env or .env.

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
    if (k && !process.env[k]) process.env[k] = line.slice(eq + 1).trim();
  }
}

loadDotEnv();

const KEY = process.env.FAL_KEY;
const MODEL = process.env.FAL_IMAGE_MODEL || "fal-ai/flux-pro/v1.1-ultra";
const ASPECT = process.env.FAL_ASPECT || "16:9";
const [, , prompt, out] = process.argv;

if (!KEY) {
  console.error("FAL_KEY is not set. Aborting.");
  process.exit(1);
}
if (!prompt || !out) {
  console.error('usage: node scripts/gen-hero-fal.mjs "<prompt>" <out.jpg>');
  process.exit(1);
}

const res = await fetch(`https://fal.run/${MODEL}`, {
  method: "POST",
  headers: { Authorization: `Key ${KEY}`, "Content-Type": "application/json" },
  body: JSON.stringify({
    prompt,
    aspect_ratio: ASPECT,
    num_images: 1,
    output_format: "jpeg",
    enable_safety_checker: true,
  }),
});

if (!res.ok) {
  console.error(`HTTP ${res.status}:`, (await res.text()).slice(0, 800));
  process.exit(1);
}

const data = await res.json();
const url = data?.images?.[0]?.url;
if (!url) {
  console.error("No image URL in response:", JSON.stringify(data).slice(0, 800));
  process.exit(1);
}

const img = await fetch(url);
if (!img.ok) {
  console.error("Download failed:", img.status);
  process.exit(1);
}
await mkdir(dirname(out), { recursive: true });
await writeFile(out, Buffer.from(await img.arrayBuffer()));
console.log("wrote", out);
