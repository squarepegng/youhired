// Builds extension/content.js from extension/content.src.js and the shared page reader
// (server/apply/agent-reader.js), so the extension reads pages exactly like YouHired's own browser.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export function buildExtension() {
  const reader = fs.readFileSync(path.join(root, "server/apply/agent-reader.js"), "utf8");
  const body = reader
    .replace(/^[\s\S]*?\(\(\) => \{/, "function __jpSnapshot(offset) {")
    .replace("let n = 0;", "let n = offset;")
    .replace(/\}\)\(\);\s*$/, "}");
  const src = fs.readFileSync(path.join(root, "extension/content.src.js"), "utf8");
  const out = src.replace("/*__SNAPSHOT__*/", body);
  fs.writeFileSync(path.join(root, "extension/content.js"), out);
  return out;
}
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  buildExtension();
  console.log("Built extension/content.js");
}
