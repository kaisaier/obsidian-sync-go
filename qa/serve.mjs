import { createReadStream } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize } from "node:path";

const root = process.cwd();
const contentTypes = { ".css": "text/css", ".html": "text/html", ".js": "text/javascript" };

createServer((request, response) => {
  const requestPath = request.url === "/" ? "/qa/sync-log-showcase.html" : request.url ?? "/";
  const filePath = normalize(join(root, requestPath));
  if (!filePath.startsWith(root)) {
    response.writeHead(403).end();
    return;
  }
  response.setHeader("Content-Type", contentTypes[extname(filePath)] ?? "application/octet-stream");
  createReadStream(filePath)
    .on("error", () => response.writeHead(404).end())
    .pipe(response);
}).listen(8765, "127.0.0.1");
