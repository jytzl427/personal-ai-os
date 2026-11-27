import { serveStatic } from "@hono/node-server/serve-static";
import type { Env, Hono } from "hono";
import { existsSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";

export function serveWeb<E extends Env>(app: Hono<E>): void {
  const webRoot = join(process.cwd(), "apps", "web", "dist");
  const index = join(webRoot, "index.html");
  if (existsSync(index)) {
    app.use("/assets/*", serveStatic({ root: relative(process.cwd(), webRoot) }));
    app.get("/", (c) => c.html(readFileSync(index, "utf8")));
  } else {
    app.get("/", (c) => c.html("<!doctype html><html><body><h1>Personal AI OS</h1><p>服务已运行。开发时请打开 Vite 页面。</p></body></html>"));
  }
}
