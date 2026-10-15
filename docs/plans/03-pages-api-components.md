# 3. 页面交互、API、组件拆分

## 3.1 共用表格行为

任务表、想法表、支出表、收入表同一套 `DatabaseTable`：

- 单元格单击进入编辑，失焦或 Enter 提交 PATCH
- Escape 取消
- 底行空输入，Enter 创建
- 乐观更新失败则回滚并 toast
- `row_version` 冲突显示「已被更新，已刷新」

标签用色块文字，不用原生 `<select>` 的系统皮肤。颜色如下。

### 任务状态

| 值 | 色 |
| --- | --- |
| 未完成 | `#8d9399` 灰 |
| 完成 | `#3f8f5a` 绿 |
| 取消 | `#c0453c` 红 |

### 想法类型 / 紧急

| 值 | 色 |
| --- | --- |
| 项目灵感 | `#c0453c` 红 |
| 长期想法 | `#3b6fb6` 蓝 |
| 短期想法 | `#d97706` 橙 |
| 1级 | `#c0453c` |
| 2级 | `#3b6fb6` |
| 3级 | `#3f8f5a` |

处理状态：已处理绿、未处理灰。

### 项目

| 值 | 色 |
| --- | --- |
| 小型项目 | `#7c5cbf` 紫 |
| 中型/阶段性 | `#c0453c` 红 |
| 长期/大型 | `#d6588c` 粉 |
| 准备开始 | `#8d9399` 灰 |
| 进行中 | `#3f8f5a` 绿 |
| 完成 | `#c0453c` 红 |
| 收益不适用 | `#8d9399` |
| 可能产生 | `#c9a227` 黄 |
| 明确产生 | `#3f8f5a` 绿 |

### 财务

支出大项：品质生活红、突发消费棕、日常消费黄、固定支出粉。  
支出小项：饭费蓝、水费灰、电费粉、饮用水绿、日用品红、休闲娱乐棕、交通费粉、电话费黄、订阅/分期灰、冲动消费橙、医药紫、生活费棕、其他灰。  
收入大项：生活费/工资棕、突发/其他收入粉、项目收入灰。  
收入小项：代抢→火山红、中转站项目紫、其他绿、生活费黄。  
资金储备：恋爱粉、紧急红、投资蓝。

合法组合写死在 `packages/core/src/finance-taxonomy.ts`，UI 和 API 共用。大项切换时若当前小项不合法，小项重置为该大项默认小项（支出日常消费→饭费，其它大项→其他）。

## 3.2 财务快捷按钮

设置键 `finance.quick_buttons`，默认：

```json
[
  { "id": "eat", "label": "吃饭", "major": "日常消费", "minor": "饭费" },
  { "id": "water", "label": "水费", "major": "固定支出", "minor": "水费" },
  { "id": "electric", "label": "电费", "major": "固定支出", "minor": "电费" },
  { "id": "daily", "label": "日用品", "major": "日常消费", "minor": "日用品" },
  { "id": "traffic", "label": "交通", "major": "日常消费", "minor": "交通费" },
  { "id": "impulse", "label": "冲动", "major": "突发消费", "minor": "冲动消费" }
]
```

点击按钮：锁定 major/minor、日期=今天，不设置账户。用户只填事件（`event`）和金额（元，提交时 `Math.round(yuan*100)`）。账户存入/取出单独使用账户流水数据库。

自然语言预览 `financeQuickParse` 保留，放在快捷按钮下方，作为次要入口。新解析要能填 major/minor；识别不到则 `未分类/其他`。

表格编辑：金额、日期、大小项、关联项目、事件、备注均可改；普通支出/收入不提供账户字段。无归档列。

资金储备页：三个账户卡片，显示名称、颜色、余额（分→元）。转账沿用现有 `POST /finance/transactions` 两腿。第一版转账用简单对话框，不新做复杂账本 UI。

统计 tab：标题「统计（即将提供）」，正文说明按周/月汇总且不删原始记录。按钮 disabled。接口见 04。

## 3.3 项目画廊与详情

画廊卡片（大尺寸，每行 2 张桌面 / 1 张窄屏）显示规格列出的 8 项。空状态：「还没有项目」+「新建项目」。

新建最小字段：名称。其余卡片上可点标签改，或进详情改。

详情：

1. 返回画廊  
2. 资料：工作区四字段、阶段列表、关联任务、问题、资料链接、归档按钮  
3. AI 设计台：该项目绑定的管家对话（`conversations.project_id`）。可「新开一轮设计」。发送时系统附带项目 JSON 摘要（名称、目标、阶段、未完成任务）。

AI **不**在前端直接写阶段。设计台走管家同一套 chat API；真正改项目/阶段/任务由：

- 用户在资料区手改，或  
- 外部 Agent 经 MCP/`batch_run` 调现有 REST  

页内工作台第一版只展示模型文本，不自动执行工具调用（避免在没确认的情况下改项目）。执行日志 = 该对话消息 + `audit_logs`。

拆出的任务出现在任务表，`task_project_links` 关联。阶段继续用 `milestones`。

## 3.4 REST 增量

前缀一律 `/api/v1`。已有接口能用的不改名。下面是第一版必须补的。

### 任务

- `GET /tasks` 增加字段：`description, due_date, archive_requested, archived_at, row_version`  
  默认 `archived=0`；`?archived=1` 给归档页。排序 `due_date DESC, created_at DESC`  
- `PATCH /tasks/:id` 接受 `archive_requested`、三态 status；服务端跑自动归档  
- `POST /tasks` 默认 `status=todo, archive_requested=0`

### 想法

- `GET /ideas` 增加 `urgency, processed, archive_requested, body, category`；`?archived=0|1`  
  排序 `urgency ASC, created_at DESC`  
- `PATCH /ideas/:id` 接受上述字段并跑自动归档  
- 现有 `promote` / `archive` 保留

### 项目

- `GET /projects` 返回画廊字段（含 workspace 摘要可选，避免 N+1：列表 SQL 一次读项目表即可）  
- `PATCH /projects/:id` 接受 `category, started_at, target_date, target_result, benefit_kind, status`  
- `GET /projects/:id` 已有资料，补这些新列

### 财务

- `PATCH /finance/expenses/:id`、`PATCH /finance/incomes/:id`  
- 创建/更新 body 含 `category_major, category_minor, event, project_id`  
- `GET /finance/quick-buttons`、`PUT /finance/quick-buttons`（设置页不做按钮编辑；第一版只 seed，PUT 留给以后）  
- `GET /finance/taxonomy` 返回大小项与颜色，避免前后端各写一份

### 健康

- `PUT /health/:date` 接受新字段；重算睡眠分钟  
- `GET /health?from&to` 已有，补列

### 复盘

- `GET /reviews?type=daily|period`  
- `PATCH /reviews/:id` 已有，按 02 的 JSON key 写  
- `POST /reviews/period` 增加 `project_id` 写入 content_json

### 管家

- `GET /conversations?archived=0|1`  
- `POST /conversations` `{ title?, project_id? }`  
- `PATCH /conversations/:id` `{ title }`  
- `POST /conversations/:id/archive`、`/restore`  
- `GET /conversations/:id/messages`  
- `POST /conversations/:id/messages` multipart 或 JSON+附件 id：文字、图片、两者  
- `POST /conversations/:id/messages/:messageId/copy` 不需要，前端直接拼文本复制  
- `GET /attachments/:id` 只本机，返回文件  
- `POST /attachments` 先上传再引用  
- `POST /butler/chat` 改为：必须 `conversation_id`；服务端读历史+新消息；API Key 从 secrets 文件读；用户消息先落库，助手回复再落库  
- `GET /workbench/config` 增加 `has_api_key`；`PATCH` 可写 key 到 secrets 文件

### 归档

- `GET /archive` 增加 `conversations`  
- `POST /archive/restore` 增加 `entity_type=conversation`

### 统计预留

- `GET /stats?domain=finance|health|reviews&from&to`  
  第一版固定 `{ ok: true, available: false, domain, from, to, series: [] }`

### 设置

- 继续 `GET/PATCH /workbench/config`  
- 禁止把 `llm.api_key` 写入 `app_settings`

## 3.5 前端文件拆分

```
apps/web/src/
  main.tsx
  index.css
  App.tsx                 只挂 AppShell + 路由
  lib/api.ts              fetch 封装、错误码
  lib/route.ts
  lib/money.ts            分↔元
  lib/labels.ts           状态/类型中文
  hooks/useHashRoute.ts
  components/AppShell.tsx
  components/Tag.tsx
  components/DatabaseTable.tsx
  components/ConfirmBar.tsx   今日待确认
  pages/TodayPage.tsx
  pages/TasksPage.tsx
  pages/IdeasPage.tsx
  pages/ProjectsPage.tsx
  pages/ProjectDetailPage.tsx
  pages/FinancePage.tsx
  pages/HealthPage.tsx
  pages/ReviewsPage.tsx
  pages/ButlerPage.tsx
  pages/ArchivePage.tsx
  pages/SettingsPage.tsx
```

`App.tsx` 最终不超过壳+switch。不要把表格逻辑再写进壳。

Vite：`server.proxy['/api'] → 127.0.0.1:4738`，前端 `fetch('/api/v1/...')`。

## 3.6 后端文件

当前业务几乎全在 `apps/server/src/app.ts`。本计划允许继续加路由，但归档判定、财务分类、睡眠计算、快捷按钮校验必须进 `packages/core`，并有单测。不要在 Hono handler 里复制规则。

建议新文件（不必一次拆完 app.ts）：

- `packages/core/src/archive.ts`
- `packages/core/src/finance-taxonomy.ts`
- `packages/core/src/sleep.ts`
- `packages/db/src/migrations.ts`
- `apps/server/src/secrets.ts`
- `apps/server/src/conversations.ts`（若 app.ts 明显过长再拆）
