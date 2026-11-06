import { build } from "esbuild";
import { createServer } from "node:http";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import postcss from "postcss";
import tailwind from "@tailwindcss/postcss";

// Deliberately static and localhost-only: no Prisma, credentials, or API proxy.
const output = path.resolve("output/smart-schedule-ui");
await mkdir(output, { recursive: true });
await build({ entryPoints: ["tests/ui/smart-schedule-harness.tsx"], outfile: `${output}/harness.js`, bundle: true, jsx: "automatic", define: { "process.env.NODE_ENV": '"development"' } });
const globals = await postcss([tailwind()]).process(await readFile("src/app/globals.css", "utf8"), { from: "src/app/globals.css", to: `${output}/globals.css` });
await writeFile(`${output}/globals.css`, globals.css);
const assets = { "/harness.js": [`${output}/harness.js`, "text/javascript"], "/harness.css": [`${output}/harness.css`, "text/css"], "/globals.css": [`${output}/globals.css`, "text/css"], "/fonts/heebo.ttf": [path.resolve("public/fonts/heebo.ttf"), "font/ttf"] };
const server = createServer(async (request, response) => {
  const pathname = new URL(request.url, "http://127.0.0.1").pathname;
  if (request.method !== "GET" || pathname.startsWith("/api/")) { response.writeHead(404); response.end("No backend in this harness"); return; }
  const asset = assets[pathname];
  if (asset) { response.writeHead(200, { "Content-Type": asset[1] }); response.end(await readFile(asset[0])); return; }
  if (pathname !== "/") { response.writeHead(404); response.end(); return; }
  response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  response.end('<!doctype html><html lang="he" dir="rtl"><head><meta name="viewport" content="width=device-width, initial-scale=1"><title>Smart schedule UI test</title><link rel="stylesheet" href="/globals.css"><link rel="stylesheet" href="/harness.css"></head><body><div id="root"></div><script src="/harness.js"></script></body></html>');
});
server.listen(3348, "127.0.0.1", () => console.log("UI-only harness: http://127.0.0.1:3348"));
