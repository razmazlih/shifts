import { cpSync, existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const standalone = path.join(root, ".next", "standalone");
const server = path.join(standalone, "server.js");
if (!existsSync(server)) throw new Error("Run npm run build before npm start.");
if (existsSync(path.join(root, ".env")))
  process.loadEnvFile(path.join(root, ".env"));
mkdirSync(path.join(standalone, ".next"), { recursive: true });
cpSync(path.join(root, "public"), path.join(standalone, "public"), {
  recursive: true,
});
cpSync(
  path.join(root, ".next", "static"),
  path.join(standalone, ".next", "static"),
  { recursive: true },
);
process.env.HOSTNAME = process.env.APP_HOST || "0.0.0.0";
await import(pathToFileURL(server).href);
