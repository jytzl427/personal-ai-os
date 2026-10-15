# 1. 总体信息架构与路由

## 1.1 产品形态（不改）

本地优先、单用户。身体 = SQLite + Web；钥匙 = MCP + `skills/paios`；管家 = 外部 Agent 为主，页内工作台为辅。

默认 `127.0.0.1:4738`。开发 Vite `127.0.0.1:5173`。桌面壳仍是 Tauri，包同一套 Web。

## 1.2 当前问题

`apps/web/src/App.tsx` 把所有板块画在同一棵树里，用 `data-page` + CSS `display:none` 切换。副作用：

- 没有真正的页面，刷新不能停留在「任务」
- 导航缺「想法」「归档」
- 任务页实际还夹着看板日历
- 财务和健康共用一块 grid
- API 配置和聊天在同一块管家面板

第一版把「一个页面一块职责」做实，不新造业务域。

## 1.3 信息架构

```
Personal AI OS
├── 今日        摘要、待确认、今日计划、快捷入口（不含完整表）
├── 任务        未归档任务数据库表
├── 想法        未归档想法数据库表
├── 项目        画廊 → 详情（资料 + AI 设计台）
├── 财务        快速记账 / 支出 / 收入 / 资金储备 / 统计(预留)
├── 健康        今日记录 + 历史时间线
├── 复盘        每日复盘 / 阶段复盘
├── 管家        左历史 / 右对话
├── 归档        任务 / 想法 / 项目 / 对话
└── 设置        API 配置（Base URL / 模型 / API Key）
```

不进归档页：财务、健康、复盘。它们永久保留原始行。

## 1.4 路由

不引入 `react-router`。用 hash，Tauri 和 `file://` 都稳。

| hash | 页面组件 |
| --- | --- |
| `#/today` | `pages/TodayPage.tsx` |
| `#/tasks` | `pages/TasksPage.tsx` |
| `#/ideas` | `pages/IdeasPage.tsx` |
| `#/projects` | `pages/ProjectsPage.tsx` |
| `#/projects/:id` | `pages/ProjectDetailPage.tsx` |
| `#/finance` | `pages/FinancePage.tsx` 默认子页 `quick` |
| `#/finance/expenses` | 支出表 |
| `#/finance/incomes` | 收入表 |
| `#/finance/accounts` | 资金储备 |
| `#/finance/stats` | 统计预留（不可用占位） |
| `#/health` | `pages/HealthPage.tsx` |
| `#/reviews` | `pages/ReviewsPage.tsx` 默认每日 |
| `#/reviews/period` | 阶段复盘 |
| `#/butler` | `pages/ButlerPage.tsx` |
| `#/butler/:conversationId` | 打开指定对话 |
| `#/archive` | `pages/ArchivePage.tsx` |
| `#/settings` | `pages/SettingsPage.tsx` |

未知 hash → `#/today`。

壳组件 `AppShell` 只负责：侧栏、当前路由、本机连接状态。右侧只渲染一个 page。

路由解析放 `apps/web/src/lib/route.ts`：

```ts
export type Route =
  | { name: "today" }
  | { name: "tasks" }
  | { name: "ideas" }
  | { name: "projects" }
  | { name: "project"; id: string }
  | { name: "finance"; tab: "quick" | "expenses" | "incomes" | "accounts" | "stats" }
  | { name: "health" }
  | { name: "reviews"; tab: "daily" | "period" }
  | { name: "butler"; conversationId: string | null }
  | { name: "archive"; tab: "tasks" | "ideas" | "projects" | "conversations" }
  | { name: "settings" };

export function parseHash(hash: string): Route { /* ... */ }
export function toHash(route: Route): string { /* ... */ }
```

侧栏高亮规则：项目详情高亮「项目」；管家子路由高亮「管家」；财务子页高亮「财务」。

## 1.5 页面草图

侧栏 220px 固定，不随右侧滚动。

```
┌────────────┬──────────────────────────────────────────┐
│ ✦ PAIOS    │  标题（当前页）              本机服务 ●  │
│            ├──────────────────────────────────────────┤
│ 今日       │                                          │
│ 任务       │           当前页内容                      │
│ 想法       │                                          │
│ 项目       │                                          │
│ 财务       │                                          │
│ 健康       │                                          │
│ 复盘       │                                          │
│ 管家       │                                          │
│ 归档       │                                          │
│ 设置       │                                          │
│            │                                          │
│ 本地 · 单用户│                                          │
└────────────┴──────────────────────────────────────────┘
```

### 今日

- 日期、时区
- 四张摘要：今日任务完成/到期、本月支出、健康是否已记、待确认数
- 今日计划列表（生成/确认，逻辑不变）
- 待确认票（批准/拒绝）
- 快捷按钮：去记账、记健康、写复盘、立即备份
- 不放完整任务表、不放财务全表

### 任务 / 想法

Notion 式表：表头、行内编辑、底行「添加」。无分页。默认未归档。

### 项目

大卡片网格，点击进详情。详情上半资料，下半 AI 设计台（作用域绑定当前项目的管家对话）。

### 财务

页内五个 tab。快捷记账：常用按钮一行，点中后只填事件和金额。

### 健康

上：今日表单。下：按日期倒序时间线。

### 复盘

两个 tab。每日按日期；阶段按项目+起止。

### 管家

```
┌─────────────┬─────────────────────────────┐
│ + 新对话     │  对话标题          复制 归档 │
│ 搜索/筛选    │                             │
│ 今天 14:02  │  消息列表                    │
│ 昨天 项目A  │                             │
│ (已归档灰)  │  [附件] [输入框] [发送]      │
└─────────────┴─────────────────────────────┘
```

### 归档

四个 tab。每行：标题、归档时间、恢复。无删除按钮。

### 设置

三个字段：Base URL、模型、API Key（password，已保存时显示占位「已配置」，不回显明文）。

备份/导出/导入：留在今日快捷入口和（可选）设置页最底部「系统维护」，不挤占 API 配置主区。

## 1.6 今日页与其它页的关系

| 今日上的动作 | 跳转 |
| --- | --- |
| 看全部任务 | `#/tasks` |
| 快捷「记一笔账」 | `#/finance` |
| 快捷「记录健康」 | `#/health` |
| 快捷「写复盘」 | `#/reviews` |
| 待确认票 | 仍在今日处理，管家页只展示对话 |

## 1.7 前端状态

已依赖 `@tanstack/react-query` 但未使用。本计划启用它：

- `QueryClientProvider` 包在 `main.tsx`
- 每页按 queryKey 拉数，避免再把全站 state 堆进 `App.tsx`
- 写成功后 `invalidateQueries`

本机 API 基址：开发走相对路径 `/api/v1`（`vite.config.ts` 已代理到 4738）；桌面生产走同源 4738。去掉 `App.tsx` 里写死的 `API_BASE = "http://127.0.0.1:4738"`。
