# 第一版界面重构 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把现有长页仪表盘改成十个独立页面，并补齐任务/想法表、项目画廊、财务分类、健康字段、管家对话与归档中心。

**Architecture:** 规则进 `packages/core`，表结构用 `schema_migrations` 增量迁移，REST 仍由 `paios serve` 单写者提供，Web 用 hash 路由 + 页面组件，管家对话落库、API Key 进 `secrets.json`。页内 LLM 不自动执行工具。

**Tech Stack:** TypeScript monorepo、Hono、better-sqlite3、React 19、Vite 6、TanStack Query、现有 MCP SDK。不新增路由库。

本仓库当前没有 `.git`，跳过所有 commit 步骤。

---

## 将改动的文件

| 路径 | 职责 |
| --- | --- |
| `packages/core/src/archive.ts` | 任务/想法自动归档判定 |
| `packages/core/src/finance-taxonomy.ts` | 大小项、颜色、快捷按钮校验 |
| `packages/core/src/sleep.ts` | 入睡+起床 → 分钟 |
| `packages/core/src/index.ts` | 导出上述模块 |
| `packages/core/src/index.test.ts` | 单测 |
| `packages/db/src/migrations.ts` | 迁移运行器 |
| `packages/db/src/schema.ts` | 新库初始 DDL（与迁移结果对齐） |
| `packages/db/src/index.ts` | openDatabase 跑迁移、账户改名、secrets 不管 |
| `packages/db/src/index.test.ts` | 迁移后列存在 |
| `packages/api-types/src/index.ts` | Zod DTO |
| `apps/server/src/secrets.ts` | 读写 `{dataDir}/secrets.json` |
| `apps/server/src/app.ts` | 新/改 REST |
| `apps/server/src/mcp.ts` | 只读+普通写工具 |
| `apps/server/src/butler.test.ts` | chat 不落 key、落对话 |
| `apps/web/vite.config.ts` | `/api` 代理 |
| `apps/web/src/**` | 壳、路由、页面 |
| `skills/paios/SKILL.md` | 项目设计与新字段 |
| `docs/MCP.md` | 工具表 |

不要改 Tauri 打包逻辑。Web 变了之后下次桌面包会带上新 UI。

---

### Task 0: 迁移运行器与新列

**Files:**
- Create: `packages/core/src/archive.ts`, `packages/core/src/sleep.ts`, `packages/core/src/finance-taxonomy.ts`
- Create: `packages/db/src/migrations.ts`
- Modify: `packages/db/src/schema.ts`, `packages/db/src/index.ts`, `packages/core/src/index.ts`
- Test: `packages/core/src/index.test.ts`, `packages/db/src/index.test.ts`

- [ ] **Step 1: 归档与睡眠纯函数测试先写后实现**

```ts
import { shouldArchiveTask, shouldArchiveIdea } from "./archive.js";
import { sleepMinutes } from "./sleep.js";

test("task archives only when requested and done/cancelled", () => {
  assert.equal(shouldArchiveTask({ archive_requested: 1, status: "todo", archived_at: null }), false);
  assert.equal(shouldArchiveTask({ archive_requested: 1, status: "done", archived_at: null }), true);
  assert.equal(shouldArchiveTask({ archive_requested: 1, status: "cancelled", archived_at: null }), true);
  assert.equal(shouldArchiveTask({ archive_requested: 0, status: "done", archived_at: null }), false);
});

test("idea archives only when requested and processed", () => {
  assert.equal(shouldArchiveIdea({ archive_requested: 1, processed: 0, archived_at: null }), false);
  assert.equal(shouldArchiveIdea({ archive_requested: 1, processed: 1, archived_at: null }), true);
});

test("sleep minutes wraps past midnight", () => {
  assert.equal(sleepMinutes("23:30", "07:00"), 450);
  assert.equal(sleepMinutes("00:10", "06:10"), 360);
  assert.equal(sleepMinutes("07:00", "07:00"), 0);
});
```

- [ ] **Step 2: 跑测确认失败（函数还不存在）**

Run: `pnpm --filter @paios/core test`  
Expected: FAIL，`Cannot find module` 或引用错误。

- [ ] **Step 3: 实现函数**

`shouldArchiveTask` / `shouldArchiveIdea` 见 02。  
`sleepMinutes(onset, wake)`：解析 `HH:MM`，`(wake+24h-onset)%24h`，四舍五入到整数分钟。非法返回 `null`。

`finance-taxonomy.ts` 导出 `EXPENSE_MAJORS`、`EXPENSE_MINORS`、`INCOME_MAJORS`、`INCOME_MINORS`、`ACCOUNT_LABELS`、`DEFAULT_QUICK_BUTTONS`、`assertFinanceCategory(kind, major, minor)`。

- [ ] **Step 4: 迁移运行器**

`applyMigrations(db)`：

1. 建 `schema_migrations`
2. `PRAGMA table_info` 缺列则 `ALTER TABLE ... ADD COLUMN`
3. `CREATE TABLE IF NOT EXISTS` 对话三表
4. 回填 archive_requested / processed / benefit_kind / 财务拆类
5. `UPDATE finance_accounts SET name=... WHERE id IN (...)`
6. 插入 `finance.quick_buttons` seed（`INSERT OR IGNORE`）
7. 记录迁移名 `001_ui_restructure`

`openDatabase` 在 `exec(INITIAL_SCHEMA_SQL)` 之后调用 `applyMigrations`。`INITIAL_SCHEMA_SQL` 同步加上新列和新表，保证全新库不依赖 ALTER。

- [ ] **Step 5: 数据库测试**

打开临时库后：

```
assert.equal(table_info(tasks).includes('archive_requested'), true)
assert.equal(get name of love, '恋爱资金')
assert.ok(SELECT name FROM sqlite_master WHERE name='conversations')
```

再 `openDatabase` 第二次，确认迁移幂等。

- [ ] **Step 6: 全量测试**

Run: `pnpm test && pnpm typecheck`  
Expected: PASS

---

### Task 1: 壳、hash 路由、页面切分

**Files:**
- Create: `apps/web/src/lib/route.ts`, `hooks/useHashRoute.ts`, `components/AppShell.tsx`, `pages/*.tsx`（先占位）
- Modify: `apps/web/src/App.tsx`, `apps/web/src/main.tsx`, `apps/web/src/index.css`, `apps/web/vite.config.ts`

- [ ] **Step 1: 去掉写死的 API 主机**

`vite.config.ts` 已有 `server.proxy['/api'] → 127.0.0.1:4738`。不要再改代理。把 `App.tsx` 里的 `API_BASE = "http://127.0.0.1:4738"` 换成 `lib/api.ts` 的相对路径 `/api/v1`（开发走 Vite 代理，桌面生产走同源 4738）。

- [ ] **Step 2: `parseHash` / `toHash` 单测**

Web 包目前无测试运行器。把纯函数放 `apps/web/src/lib/route.ts`，用 `packages/core` 不合适。第一版用手工：在 `route.ts` 写函数，`pnpm --filter @paios/web typecheck` 过即可。覆盖：`#/projects/abc`、`#/finance/expenses`、空 hash、垃圾 hash。

- [ ] **Step 3: AppShell + 十项导航**

导航文案：今日、任务、想法、项目、财务、健康、复盘、管家、归档、设置。  
点击写 `location.hash`。`hashchange` 更新页面。右侧只渲染匹配的 page。

占位页显示标题即可，保证点每一项都不再出现其它页内容。删除 `index.css` 里整段 `[data-page]` 显隐规则。

- [ ] **Step 4: 把今日现有摘要迁到 TodayPage**

今日仍调用 `/today`、计划、确认、备份。其它板块从 TodayPage 删除。

- [ ] **Step 5: typecheck**

Run: `pnpm --filter @paios/web typecheck`  
Expected: PASS

---

### Task 2: 任务表 + 自动归档

**Files:**
- Modify: `packages/api-types/src/index.ts`, `apps/server/src/app.ts` `GET/POST/PATCH /tasks`
- Create: `apps/web/src/components/DatabaseTable.tsx`, `pages/TasksPage.tsx`
- Test: core 归档已在 Task 0；补一条 HTTP 级：PATCH done+archive_requested 后 `GET /tasks` 不含该行，`GET /tasks?archived=1` 含该行

- [ ] **Step 1: API**

`GET /tasks` 返回 `id,title,description,status,due_date,archive_requested,archived_at,row_version`。查询 `archived=0`（默认）过滤 `archived_at IS NULL`。排序 `due_date IS NULL, due_date DESC, created_at DESC`。

PATCH 后：

```
if (shouldArchiveTask(next)) UPDATE archived_at=now, archive_reason='auto', archived_by='user'
```

status 只接受 `todo|done|cancelled`（把旧 `doing|blocked` 的 PATCH 映射到 `todo`）。

- [ ] **Step 2: UI**

列：归档、名称、日期、状态、备忘。底行添加。状态 Tag 三色。勾选归档但未完成时行仍在，checkbox 保持勾。

- [ ] **Step 3: 测试**

在 `packages/db` 或 server 测试里用临时库走 create → patch archive+todo（仍 active）→ patch done（进入归档）。

Run: `pnpm test`  
Expected: PASS

---

### Task 3: 想法表 + 自动归档

与任务对称。`urgency` 1–3，非法 400。列表 `ORDER BY urgency ASC, created_at DESC`。`promote` 行为不变。

UI 无「升级为任务」也可先不做按钮；规格没要求该按钮在表上。第一版在行尾可选「升级」，走现有确认票。若时间紧，升级仍只通过 MCP。**本计划要求表上有「升级」**，因为现有产品已有该能力。

---

### Task 4: 项目画廊与详情

- 列表改卡片，字段按 02  
- `PATCH` 新列  
- 详情读 workspace / milestones / tasks / issues / links  
- 设计台：`POST /conversations { project_id }` 后内嵌 Butler 组件（Task 8 完成前可用「打开管家」链接代替内嵌）

新建项目对话框只要名称。

---

### Task 5: 财务

- taxonomy API + PATCH 支出/收入  
- 快捷按钮区  
- 四个可用 tab + 统计占位  
- 账户三卡片改名  
- `financeQuickParse` 尽量匹配小项字典；测「吃饭 25」→ 25_00 分、major 日常消费、minor 饭费（若解析仍偏弱，快捷按钮必须正确，解析器可第二优先级）

金额输入：元，提交分。显示 `¥xx.xx`。

---

### Task 6: 健康

扩展 PUT。时间线 `GET /health?from=1900-01-01&to=今天`（或最近 365 天，避免全表过大：默认 365）。

---

### Task 7: 复盘

每日表单绑 `content_json` keys。状态草稿/已完成走 finalize。阶段复盘选项目 + 日期 + 三个文本字段。

生成按钮继续调 `POST /reviews/daily/:date/generate`，生成后把 `data` 填进「AI 观察」初稿（把 JSON data 格式化成短文本），用户可改。

---

### Task 8: 管家对话与图片

顺序：secrets.ts → conversations CRUD → attachments → 改 `/butler/chat` 必须带 `conversation_id` → 改 `butler.test.ts`：

- 不把 key 写入 sqlite / audit  
- 消息行数为 2（user+assistant）  
- `GET /workbench/config` 无 api_key 字段  

前端：左列表、右消息、新对话、归档、复制、`<input type=file accept=image/* multiple>`。

设置页先于管家可用（Task 9 可与 8 并行后半，但 chat 需要 secrets，设置页应先能保存 key）。**把设置页 API 表单放在 Task 8 开头做。**

---

### Task 9: 归档中心

四个 tab。恢复调用统一 restore。筛选：标题包含。不做删除。`GET /archive` 扩 conversations。

---

### Task 10: 统计预留 + Skill/MCP 文档

- `GET /stats` 返回 `available:false`  
- 财务 tab 占位  
- MCP 新工具  
- 更新 `docs/MCP.md`、`skills/paios/SKILL.md`

---

## 每阶段统一验收命令

```bash
pnpm typecheck
pnpm test
pnpm --filter @paios/web build
```

开发手测：`pnpm dev`，打开 `http://127.0.0.1:5173`，按 06 的清单点一遍。

桌面包不是本计划验收项。UI 稳定后再 `pnpm --filter @paios/desktop tauri:build`。
