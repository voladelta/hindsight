import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createApi } from "./api";
import { openStore } from "./db";

const production = process.argv.includes("--production");
const port = Number(process.env.PORT ?? 3000);
const origin = process.env.APP_ORIGIN ?? `http://localhost:${port}`;
const store = openStore();
const api = createApi(store, origin);
const server = createServer();
const vite = production
  ? null
  : await (
      await import("vite")
    ).createServer({
      server: {
        middlewareMode: true,
        ws: { server },
        watch: { ignored: ["**/.data/**"] },
      },
      appType: "spa",
    });

server.on("request", async (req, res) => {
  const pathname = new URL(req.url ?? "/", origin).pathname;
  res.setHeader("Cache-Control", "private, no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "same-origin");
  try {
    if (pathname.startsWith("/api/")) {
      const chunks: Buffer[] = [];
      let size = 0;
      for await (const chunk of req) {
        size += Buffer.byteLength(chunk);
        if (size > 1024) {
          res.writeHead(413, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Request too large." }));
          return;
        }
        chunks.push(Buffer.from(chunk));
      }
      const headers = new Headers();
      for (const [name, value] of Object.entries(req.headers))
        if (value)
          headers.set(name, Array.isArray(value) ? value.join(", ") : value);
      const response = await api(
        new Request(new URL(req.url!, origin), {
          method: req.method,
          headers,
          ...(req.method === "GET" || req.method === "HEAD"
            ? {}
            : { body: Buffer.concat(chunks).toString() }),
        }),
      );
      res.writeHead(response.status, Object.fromEntries(response.headers));
      res.end(await response.text());
      return;
    }
    if (vite) {
      vite.middlewares(req, res, () => {
        res.writeHead(404);
        res.end("Not found");
      });
      return;
    }
    if (req.method !== "GET" && req.method !== "HEAD") {
      res.writeHead(405);
      res.end();
      return;
    }
    const isPage = pathname === "/" || /^\/play\/[0-9a-f-]{36}$/.test(pathname);
    const isAsset = /^\/assets\/[A-Za-z0-9_.-]+\.(js|css|png|woff2)$/.test(
      pathname,
    );
    if (!isPage && !isAsset) {
      res.writeHead(404);
      res.end("Not found");
      return;
    }
    const file = resolve("dist", isPage ? "index.html" : pathname.slice(1));
    const data = await readFile(file);
    res.setHeader(
      "Content-Type",
      isPage
        ? "text/html; charset=utf-8"
        : pathname.endsWith(".js")
          ? "text/javascript"
          : pathname.endsWith(".css")
            ? "text/css"
            : pathname.endsWith(".png")
              ? "image/png"
              : "font/woff2",
    );
    res.setHeader(
      "Content-Security-Policy",
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
    );
    res.end(req.method === "HEAD" ? undefined : data);
  } catch {
    res.writeHead(500, { "Content-Type": "text/plain" });
    res.end("Unable to serve this request.");
  }
});
server.listen(port, "127.0.0.1", () =>
  console.log(
    `Hindsight ready at ${origin} (${production ? "production" : "development"})`,
  ),
);
function close() {
  server.close();
  void vite?.close();
  store.sqlite.close();
  process.exit(0);
}
process.on("SIGTERM", close);
process.on("SIGINT", close);
