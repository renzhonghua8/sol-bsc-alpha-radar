import fs from "fs";
import http from "http";
import path from "path";
import { fileURLToPath } from "url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const dist = path.join(root, "dist");
const port = process.env.CLIENT_PORT || 5174;
const types = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8"
};

http
  .createServer((req, res) => {
    const url = new URL(req.url, `http://localhost:${port}`);
    const requested = url.pathname === "/" ? "/index.html" : url.pathname;
    const filePath = path.normalize(path.join(dist, requested));

    if (!filePath.startsWith(dist)) {
      res.statusCode = 403;
      res.end("Forbidden");
      return;
    }

    fs.readFile(filePath, (error, content) => {
      if (error) {
        fs.readFile(path.join(dist, "index.html"), (fallbackError, fallback) => {
          if (fallbackError) {
            res.statusCode = 404;
            res.end("Not found");
            return;
          }
          res.setHeader("content-type", types[".html"]);
          res.end(fallback);
        });
        return;
      }
      res.setHeader("content-type", types[path.extname(filePath)] ?? "application/octet-stream");
      res.end(content);
    });
  })
  .listen(port, () => {
    console.log(`BSC Early Alpha Radar UI listening on http://localhost:${port}`);
  });
