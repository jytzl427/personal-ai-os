import { serveStatic } from "@hono/node-server/serve-static";
import type { Env, Hono } from "hono";
import { existsSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

export function serveWeb<E extends Env>(app: Hono<E>): void {
  const webRoot = [
    join(process.cwd(), "apps", "web", "dist"),
    fileURLToPath(new URL("../../web/dist/", import.meta.url))
  ].find((directory) => existsSync(join(directory, "index.html")));
  if (webRoot) {
    app.use("/assets/*", serveStatic({ root: relative(process.cwd(), webRoot) }));
    app.get("/", (c) => c.html(readFileSync(join(webRoot, "index.html"), "utf8")));
  } else {
    app.get("/", (c) => c.html("<!doctype html><html><body><h1>Personal AI OS</h1><p>服务已运行。开发时请打开 Vite 页面。</p></body></html>"));
  }
}
