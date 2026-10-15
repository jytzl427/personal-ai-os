# Personal AI OS 完整产品与实施计划（v2）

**现行接手文档：** [`交付手册.md`](./交付手册.md)。本文件是历史产品计划，不是当前待办清单。

**文档性质：** 可执行产品 / 架构 / UI / 项目管理计划（本文件不写业务代码）  
**版本：** v2（审阅修订稿，决策已锁定；实施状态以 CURRENT-STATE 为准）  
**原则：** 先结论、先 MVP、可落地、不过度设计、不绑定第三方 AI 平台  
**核心设计一句话：** 本地数据库 + 可视化 Web 是身体；MCP + Skill 是钥匙；AI 管家是角色——优先外接任意 Agent，其次才在页面提供可选工作台。

**最新财务口径（2026-09-02）：** 支出、收入、账户是三个完全独立的数据库。普通支出和普通收入不代表资金来源，不关联账户、不创建账户流水、不改变账户余额；账户只用于管理专门用途资金的存入和取出。后文若有旧版“默认账户”“支出联动账户”描述，以本条为准。

---

## 审阅修订说明（相对 v1）

v1 方向正确，但不能直接开工。v2 只修「自相矛盾 / 缺实体 / 算法不可编码 / 还在问人」四类问题，不改产品方向。

| 级别 | v1 问题 | v2 处理 |
|---|---|---|
| 阻断 | `serve` 与 `mcp` 两个进程都写 SQLite | **单写者**：只有 `paios serve` 打开数据库；`paios mcp` 默认 HTTP 转发，未启动 serve 时才 in-process 内嵌同一 Core |
| 阻断 | 「财务四库」只是表前缀 | 四个限界上下文，**域之间不用 SQLite FK**；仓储接口可换成 4 个文件 |
| 阻断 | 项目「问题」「资料」有 Tab 无表 | 新增 `project_issues`、`project_links` |
| 阻断 | 确认票 15 分钟过期，用户来不及在 UI 点 | parked 7 天 / interactive 30 分钟；仅 UI 批准；`executeTicket` 恰好一次 |
| 缺口 | 日计划 / 复盘生成无法编码 | 第 10.5 / 10.6 给出可实现算法与模板 |
| 缺口 | 八个 workflow scope 无默认 spec | 第 12.3 给出 v1 seed JSON |
| 缺口 | 路由承诺了看板/日历，MVP 又砍掉 | 第 8.4：MVP 做静态看板 + 点选月历，拖拽与时间线 P6 |
| 缺口 | 无 REST 目录，前端无法落地 | 第 6.2 / 附录 A |
| 缺口 | 「昨晚入睡」日期归属未定义 | 归属「称体重的那天」那条 `health_logs` |
| 决策 | 第 23 节还在等确认 | **D1–D12 按推荐锁定**，变更走 ADR，不阻塞 P0 |

---

## 0. 先给结论（最终推荐方案）

**产品形态：** 第一阶段本机单用户 Web（浏览器只访问 `http://127.0.0.1:4738`）；同一套前端与 Core 在 P7 用 Tauri 2 封装；更远期响应式 / PWA 覆盖平板和手机，不重写业务。

**技术形态：**

| 层 | 锁定 |
|---|---|
| 真相源 | 本机一个 SQLite 文件（WAL）。财务四个域逻辑独立、物理同库、无跨域 FK |
| 业务层 | 本机 HTTP API（TypeScript / Hono），规则只写在 `packages/core` |
| 可视化 | React SPA，深色优先，桌面主、平板/手机能用 |
| 钥匙 | MCP（stdio 适配器 + 本机 Streamable HTTP）+ `skills/paios` |
| AI 管家 | 不内置模型。主路径：任意 Agent 经 MCP。辅路径：P6 页面工作台，用户自备任意 OpenAI 兼容接口 |

**默认端口 `4738`，默认只绑 `127.0.0.1`。**

**全局不做：** 云账号、多用户协作、绑定某一家模型云、AI 改代码、AI 改表结构、AI 物理删除财务历史。

**为什么这是最不容易做废的路：** 资产是数据和规则不是供应商；换 Agent 只换钥匙使用者；本地 Web 最快且可被 Tauri 原样包住；单文件备份简单；页内 LLM 不阻塞「系统已经能被管家使用」。

---

## 1. 产品重新定义

### 1.1 一句话

Personal AI OS 是给**一个人**用的本地优先个人操作系统：可视化界面管理生活与工作数据；MCP + Skill 把同一套数据交给任意 AI Agent 当管家。它不是聊天机器人套壳。

### 1.2 三个部件（必须始终分开）

```
┌──────────────────────────────────────────────┐
│  身体：本地数据库 + 可视化 Web                 │
│  所有状态以数据库为准，界面只是观察和操作入口   │
├──────────────────────────────────────────────┤
│  钥匙：MCP 工具/资源 + Skills 操作手册         │
│  任何兼容 MCP 的 Agent 按同一契约工作          │
├──────────────────────────────────────────────┤
│  管家：外部 Agent（主） / 页面工作台（辅，P6） │
│  管家没有私有库，只能通过钥匙碰身体            │
└──────────────────────────────────────────────┘
```

### 1.3 用户

单人、本机、要管日程/项目/财务/健康/复盘，但不把生活数据交给某一家云 AI。可同时用 Codex、Claude Code、Grok 或其他 Agent，系统一视同仁。

### 1.4 主路径

1. 打开本机 Web，自己查看、补录、纠错、确认高风险操作。
2. 在任意 Agent 加载本仓库 `skills/paios`，经 MCP 读/写/做计划/写复盘。
3. 高风险操作出确认票，人在 `/butler` 点头后才落库。
4. P6 起可在工作台接自备 LLM，走同一套 REST/Core，不走第二套语义。

### 1.5 成功标准（体感）

- 打开首页几秒内知道：今天做什么、钱和身体有没有异常、有没有待确认。
- 换 Agent，只配 MCP + Skill，仍能「记一杯咖啡、安排明天、写昨晚复盘」。
- 一年后的统计和复盘仍能算，即使中间归档过很多项目。

### 1.6 名词对照（避免开发时各说各话）

| 用户语言 | 系统实体 | 说明 |
|---|---|---|
| 项目 / 子项目 | `projects.parent_id` | 树，层数不限，MVP 交互按两层测 |
| 阶段 | `milestones` | 项目下的规划单元，**不是**第三种任务类型 |
| 阶段任务 | `tasks` + `task_milestone_links` | 普通任务挂到阶段 |
| 待办 / 任务 | `tasks` | 独立实体，可以不属于任何项目 |
| 想法与长期事项 | `ideas` | AI 可在计划/复盘时提醒，但不得擅自把想法变成任务 |
| 财务四库 | 四个域 + 四组表 | 见 7.6，不是四套产品 |
| AI 管家对话页 | `/butler` | MVP = 连接 + 确认 + 审计；真正聊天在外部 Agent 或 P6 |

---

## 2. 产品目标与非目标

### 2.1 目标

- 成为个人数据的唯一可信源：任务、项目、财务、健康、想法、复盘。
- 任意 Agent 通过稳定契约当管家，而不是做成某模型套壳。
- 没有 Agent 时，界面仍然完整好用。
- 层级项目、独立任务、依赖、进度、项目工作区；财务四域；健康四字段；每日/阶段复盘。
- AI 可进化「怎么问、怎么排、怎么复盘」，不可进化「系统是什么」。

### 2.2 非目标（尤其 MVP 不做）

- 多用户、家庭共享、云端同步 SaaS
- 自动对接银行 / 微信支付宝 / Apple Health
- 投资交易全套（持仓、收益率 → P8）
- 习惯 / 饮食 / 心情完整追踪
- 内置或必装本地大模型
- AI 改仓库代码、自动迁移表结构
- 社交、插件市场、超级 Dashboard
- 任务循环规则、甘特图、附件二进制上传
- 页内 LLM 工作台（P6）
- 物理执行 purge（MVP 只生成申请与确认票）

### 2.3 假设与替代（已按此执行）

| ID | 假设 | 若推翻则替代 |
|---|---|---|
| A1 | 同时只有一个写者进程 | 已用单写者 + `paios.lock`；不必 Postgres |
| A2 | 数据只留本机 | 多设备以后做加密包导出/导入，不做账号云 |
| A3 | 财务四库 = 四个限界上下文，MVP 同文件 | 仓储可改为 4 个 `.sqlite`，MCP/UI 不动 |
| A4 | 「今日」= 设置时区下的本地日历日 | 设置可改 timezone；禁止用 UTC 日期当 `log_date` |
| A5 | UI 中文；代码与 MCP 英文 | 以后再 i18n |
| A6 | 不接系统日历/邮件 | 以后只读 ICS |
| A7 | 收益非必填，项目级开关默认关 | 保持可空 |
| A8 | 页内工作台不进 MVP | P6 用同一 API 加聊天壳 |
| A9 | Windows 上 `better-sqlite3` 可能编译失败 | 仓储改 `@libsql/client` `file:`，接口不变 |
| A10 | 自然语言记账不单独做 NLP 服务 | Agent 结构化调用；页面可有关键词快记预览 |

---

## 3. Web 应用和桌面应用方案比较

| 维度 | 本地 Web（Vite SPA + 本机服务） | 一上来就桌面（Electron / Tauri） |
|---|---|---|
| 开发成本 | 低，浏览器即预览 | 中高：窗口、托盘、安装包、更新 |
| 跨平台 | Win/macOS/Linux 同源 | 要分别打包，WebView 要双测 |
| 离线 | 本机服务 + SQLite，断网可用 | 同样离线，更像「软件」 |
| 数据安全 | 默认 localhost；误暴露端口是主风险 | 无开放端口，但安装包供应链要管 |
| MCP | Agent 拉起 stdio 或连本机 HTTP，都顺 | stdio 自然，但窗口生命周期要设计 |
| 维护 | 改 UI 不用重装 | 每次发版打包 |
| 移动/平板 | 同一套响应式 | 桌面包变不成手机 App |
| 体感 | 要启动服务，略偏开发者 | 双击即用 |
| 适合阶段 | **现在（P0–P5）** | **P7** |

**结论：** 不是单选题。先用 Web 把身体和钥匙做对，再套 Tauri。一上来做桌面，安装包和托盘会变成假进度。

---

## 4. 推荐的最终产品形态

### 4.1 分阶段形态

1. **P0–P5 本机 Web OS（MVP）**  
   `pnpm start` / `scripts/start.ps1` 拉起唯一服务；浏览器打开 `http://127.0.0.1:4738`；MCP stdio 适配器转发给该服务。
2. **P6 同一套 UI 增强**  
   页内工作台、看板、日历、时间线、阶段复盘模板。
3. **P7 Tauri 2**  
   WebView 加载同一 dist；后台即原来的 `paios serve`；托盘、单实例、用户数据目录。
4. **P8 平板/手机与业务扩展**  
   先 PWA/响应式；不做独立原生 App，除非桌面稳定三个月以上。

### 4.2 运行时（锁定）

```
浏览器 / 未来 Tauri WebView
        │  REST（同源，/api/v1）
        ▼
   paios serve     ← 唯一 SQLite 写者
        │
        ├─ packages/core
        ├─ paios.db (WAL)
        ├─ 可选 MCP Streamable HTTP (127.0.0.1)
        └─ paios.lock 单实例
                ▲
                │ HTTP 127.0.0.1:4738  （默认）
         paios mcp  (stdio 适配器，无独立写连接)
                ▲
         任意 Agent + skills/paios
```

**禁止：** `paios mcp` 与 `paios serve` 同时直接 `open(paios.db)`。  
**允许：** 环境变量 `PAIOS_URL` 未设置且锁文件不存在时，`paios mcp` **in-process** 启动同一 Core（仍是一个进程、一个写者）。

---

## 5. 总体技术架构

### 5.1 分层（强制）

```
界面层 UI          只渲染、发请求、不做业务判断
接口层 REST/MCP    鉴权、Zod 校验、确认票、审计
领域层 Core        日程/财务四域/健康/复盘/想法/归档/工作流/计划算法
数据层 Repos       接口在 core，SQLite 实现在 packages/db
```

铁律：UI 不直连 SQLite；MCP 不自己写 SQL；Agent 无秘密权限；财务四域互不 FK。

### 5.2 进程与启动

| 命令 | 作用 |
|---|---|
| `paios serve` | Web 静态资源 + `/api/v1` + 可选 MCP HTTP；占 `paios.lock` |
| `paios mcp` | stdio MCP；连 `PAIOS_URL`（默认 `http://127.0.0.1:4738`） |
| `pnpm start` | 生产态：serve 托管 `apps/web/dist` |
| `pnpm dev` | Vite :5173 代理到 serve :4738 |

开发态数据目录：仓库 `.data/`（gitignore）。  
正式数据目录：Windows `%USERPROFILE%\.paios\`，macOS/Linux `~/.paios/`。

```
.data/ 或 ~/.paios/
  paios.db
  paios.db-wal
  paios.lock
  backups/
  logs/
  config.json     # 端口、bind、时区覆盖；不含明文第三方密钥
```

`config.json` 可改端口；`bind` 不是 `127.0.0.1` 时必须在设置里二次确认后才生效。

### 5.3 数据库可替换（不过度，但接口要真）

Core 只依赖仓储接口，按域拆文件：

```
packages/core/src/repos/
  tasks.ts  projects.ts  milestones.ts  ideas.ts
  finance/accounts.ts  finance/expenses.ts
  finance/incomes.ts   finance/transactions.ts
  health.ts  reviews.ts  audit.ts  tickets.ts  workflows.ts
packages/db/src/sqlite/   ← MVP 唯一实现
```

替换方式：

| 目标 | 做法 |
|---|---|
| Postgres | 新包 `packages/db-pg` 实现同一接口 + 迁移，环境变量切换 |
| 财务四库物理拆分 | 四个 `file:fin_*.sqlite`，四个 finance repo 指向不同连接，**禁止跨库 JOIN**（本来也没有跨域 FK） |
| Windows 编译失败 | `better-sqlite3` → `@libsql/client`，仍走 sqlite repo |

**不做**运行时热插拔引擎。

跨域引用（如 `fin_expenses.account_id`）只存 ID 字符串，**不建 SQLite FOREIGN KEY**。日程域内 `milestones.project_id`、`task_project_links` 可以建 FK。财务四库拆文件时不必先拆跨域 FK。

### 5.4 多 Agent 兼容

- 工具名、Zod schema、错误码视为公共契约，改名必须升文档版本并保留旧名至少一个小版本（MVP 冻结后才谈兼容，开发期可改但要改 Skill）。
- Skill 禁止写死「必须用 Claude / Codex」。
- 每个 Agent 最多一份「如何注册 MCP」的薄说明（附录 C），不改工具。
- 页内工作台走 REST，MCP 走同一 Core 函数。

---

## 6. 前端、后端、数据库和 MCP 的职责划分

| 组件 | 负责 | 不负责 |
|---|---|---|
| 前端 | 信息架构、列表/表/少量图、表单、确认对话框、深色主题、展示待确认票 | 进度公式、归档策略、余额、权限 |
| REST `/api/v1` | Session/令牌、DTO、把 HTTP 转 Core、静态资源 | 提示词、模型选择 |
| MCP | 把同一 Core 暴露为 tools/resources | 另一套 CRUD |
| Core | 实体规则、成环检测、进度、计划算法、复盘聚合、确认票、workflow schema | UI、具体哪家模型 |
| SQLite | 持久化、事务、索引 | 业务 |
| Skills | 教 Agent 先读后写、什么必须问人 | 可执行后门 |
| AI 管家 | 读、整理、建议、起草；确认后调用写接口 | 改代码、改表、静默删财务史 |

### 6.1 调用链

```
UI 按钮 → REST → Core.foo() → Repo
Agent 工具 → MCP adapter → Core.foo() → Repo   （同一函数）
```

### 6.2 REST 与 MCP 对照（摘要，完整路径见附录 A）

| 能力 | REST | MCP tool |
|---|---|---|
| 今日总览 | `GET /api/v1/today` | resource `paios://today` |
| 任务 CRUD | `/api/v1/tasks` | `tasks_*` |
| 项目/工作区 | `/api/v1/projects` | `projects_*` |
| 阶段 | `/api/v1/milestones` | `milestones_*` |
| 日计划 | `/api/v1/plans/:date` | `plans_*` |
| 想法升级 | `POST /ideas/:id/promote` | `ideas_promote_to_task` |
| 财务四域 | `/api/v1/finance/*` | `finance_*` |
| 健康 | `/api/v1/health/:date` | `health_*` |
| 复盘 | `/api/v1/reviews` | `reviews_*` |
| 确认票 | `/api/v1/confirmations` | 无 MCP 批准工具（Agent 恒 FORBIDDEN；只走 REST UI） |
| 备份 | `POST /api/v1/system/backup` | 无（admin，不给 Agent） |

REST 与 MCP 共用 `packages/api-types` 的 Zod schema。金额在契约里**一律整数分**。

命令总线原则（每个 Core 命令一行，完整清单实施时写入 `docs/MCP.md`）：`command` · `REST` · `MCP tool` · `scope` · `confirm?`。例如 `ideas.promote` → `POST /ideas/:id/promote` → `ideas_promote_to_task` → write → 是。UI 只调 REST，不解析 MCP 包装。P0 **不做 SSE**（规则引擎是同步的）。

---

## 7. 数据模型和数据库字段设计

### 7.1 物理库

- 文件：`paios.db`，`PRAGMA journal_mode=WAL`；`busy_timeout=5000`。
- 主键：`TEXT` UUID。
- 金额：整数分 + `currency` 默认 `CNY`。禁止 float 金额。
- 启动时 `PRAGMA integrity_check`；失败则只读并提示恢复备份。
- **日期与时间拆开（禁止混用）：**

| 类型 | 存什么 | 字段 |
|---|---|---|
| 日历日 `*_date` | `TEXT` `YYYY-MM-DD`，用户时区日历日，**禁止**带 `Z`/偏移 | `due_date`, `scheduled_date`, `plan_date`, `log_date`, `period_start`, `period_end`, `occurred_date` |
| 时刻 `*_at` | `TEXT` UTC `YYYY-MM-DDTHH:MM:SSZ` | `created_at`, `updated_at`, `occurred_at`, `expires_at`, `completed_at` |
| 本地钟点 | `TEXT` `HH:MM` | `sleep_onset_local`, `workday_start` |

Core `today()` = `users.timezone` 的日历日。禁止 `toISOString().slice(0,10)` 当「今天」。

业务主表另加 `row_version INTEGER NOT NULL DEFAULT 1`，每次 update 自增；冲突返回 `STALE_VERSION`。

### 7.2 通用归档列（业务主表）

```
id              TEXT PK
created_at      TEXT NOT NULL
updated_at      TEXT NOT NULL
archived_at     TEXT NULL
archive_reason  TEXT NULL
archived_by     TEXT NULL    -- user | agent | system
```

进行中列表：`archived_at IS NULL`。历史统计 / 复盘：按时间窗，**包含已归档**。财务主表同样有归档列，但 **purge 默认排除财务**。

### 7.3 系统域

**users**（seed 一行 `id=local`）

- `id`, `display_name`, `timezone`, `created_at`

**app_settings**：`key TEXT PK`, `value_json`, `updated_at`

锁定默认键：

| key | 默认 |
|---|---|
| `theme` | `"dark"` |
| `timezone` | 首次启动取 OS，失败 `Asia/Shanghai` |
| `currency` | `"CNY"` |
| `week_starts_on` | `1` |
| `finance.expense_writes_tx` | `true` |
| `finance.income_writes_tx` | `true` |
| `bind` | `"127.0.0.1"` |
| `port` | `4738` |
| `backup.retain` | `3` |
| `archive.purge_after_days` | `90` |
| `archive.scan_weekday` | `0`（周日扫描，只建票不执行） |

**api_tokens**：`id`, `name`, `token_hash`, `scopes_json`, `created_at`, `last_used_at`, `revoked_at`

P0 seed 一枚开发用 token 写到 `.data/mcp-token.txt`（gitignore），scopes=`["read","write"]`。

**audit_logs**：`id`, `at`, `actor` (`user|agent|system`), `agent_name`, `tool_name`, `action`, `entity_type`, `entity_id`, `request_json`, `result` (`ok|denied|error|pending_confirm`), `ip`

密钥打码；金额保留。

**confirmation_tickets**：`id`, `action`, `payload_json`（已校验的 Core 命令，**此时业务表零行**）, `human_summary`, `risk` (`high`), `ttl_class` (`interactive|parked`), `status` (`pending|approved|rejected|expired|superseded|executed|failed`), `created_at`, `expires_at`, `resolved_at`, `resolved_by`, `executed_at`

- `interactive`：Agent 对话中等待，TTL **30 分钟**。
- `parked`：想法升级、归档、财务历史、workflow、purge、force done，TTL **7 天**；出现在首页与 `/butler`。
- 批准走同一 `Core.executeTicket(id)`：开事务 → 未过期 → 执行 payload 恰好一次 → audit → `executed`。重复批准幂等返回原结果。
- 过期票禁止执行；UI 提供「按原内容重新提交」生成新票。
- **仅 UI（浏览器 session）可批准。** MCP `confirm_ticket` 对 Agent 恒 `FORBIDDEN`。

**workflow_versions**：见第 12 节。每 scope 同时仅一个 `active`。

**purge_jobs**：`id`, `requested_at`, `scope_json`, `status` (`proposed|approved|rejected|executed`), `confirmed_by`, `executed_at`, `result_json`

定期清理：每次 `paios serve` 启动时，若本地星期 = `archive.scan_weekday` 且今日尚未扫描，首页出「有 N 条已归档超过 N 天，是否查看清理清单」→ `purge_jobs` + parked 票。清理前必须人工确认。

**业务主表永不物理删除**（任务、项目、财务、复盘、健康、想法）。归档=软删除。统计进行中视图 `archived_at IS NULL`；历史视图按时间窗包含归档行。复盘只读生成时的 snapshot JSON，finalize 后四块 summary **禁止再 update**。

MVP purge **不执行**。P8 若执行，白名单仅限日后的附件；财务/复盘/流水 UI 不能勾选。不用 JSON 快照做「引用检测」。

### 7.4 日程域

**projects**

- 通用列
- `parent_id` NULL
- `title`, `status` (`planned|active|paused|done|dropped`)  -- 灵感走 `ideas`，不占用项目状态
- `start_date`, `target_date`, `actual_end_date`
- `progress_manual` REAL NULL
- `progress_cached` REAL NOT NULL DEFAULT 0
- `benefit_enabled` INTEGER NOT NULL DEFAULT 0
- `expected_benefit_cents` INTEGER NULL
- `actual_benefit_cents` INTEGER NULL
- `benefit_note` TEXT NULL
- `color`, `sort_order`

**project_workspace**（1:1，项目创建时插入空行）

- `project_id` PK
- `intro`, `goals`, `reality`, `notes`

**project_issues**（工作区「问题」）

- 通用列，`project_id`, `title`, `body`, `status` (`open|resolved`), `sort_order`

**project_links**（工作区「资料」，MVP 只外链）

- 通用列，`project_id`, `title`, `url`, `sort_order`

**milestones**（阶段）

- 通用列，`project_id`, `title`, `description`, `status` (`planned|active|done|dropped`)
- `start_date`, `target_date`, `sort_order`, `progress_cached`

**tasks**

- 通用列
- `title`, `description`
- `status` (`todo|doing|done|blocked|cancelled`)
- `priority` (`p0|p1|p2|p3`) 默认 `p2`
- `due_date`, `scheduled_date`
- `estimate_minutes`, `actual_minutes`
- `energy` (`low|mid|high`) NULL
- `source` (`user|agent|review`)
- `completed_at`, `blocked_reason`

**task_project_links**（拆表，避开 SQLite UNIQUE 把 NULL 当不相等）

- `task_id`, `project_id`, `role` (`belongs|contributes`) 默认 `belongs`
- PRIMARY KEY (task_id, project_id)

**task_milestone_links**

- `task_id`, `milestone_id`
- PRIMARY KEY (task_id, milestone_id)
- 写入时 Core 自动确保对应 `task_project_links` 存在，且 milestone.project_id 一致

无项目任务 = 两张链接表都没有该 task。进度只计 `role=belongs`。

**dependencies**

- `id`
- `from_type`, `from_id`  -- 前置
- `to_type`, `to_id`      -- 被阻塞
- `type` 仅 `fs`
- UNIQUE(from_type, from_id, to_type, to_id)
- 写入前 DFS 成环 → `CYCLE_DETECTED`
- `*_type` ∈ `project|task|milestone`

**daily_plans**

- `id`, `plan_date` UNIQUE, `status` (`draft|confirmed|executed`)
- `summary`, `generated_by` (`rules|agent|user`), `user_adjustments`
- `workflow_version_id`

**daily_plan_items**

- `id`, `plan_id`, `task_id` NULL, `project_id` NULL, `custom_title` NULL
- `slot` (`morning|afternoon|evening|anytime`)
- `sort_order`, `done` INTEGER DEFAULT 0, `skip_reason`
- CHECK：task / project / custom_title 至少一个

### 7.5 想法域

**ideas**

- 通用列
- `title`, `body`
- `category`：`project_spark|short|long_goal|life|learning|watch|parked`
- `related_project_id` NULL（无 FK）
- `promoted_task_id` NULL
- `remind_in_plan` INTEGER DEFAULT 1
- `remind_in_review` INTEGER DEFAULT 1

`ideas_promote_to_task` → 确认票 → 执行时建 task，回写 `promoted_task_id`。**不**自动归档想法。Agent **不得擅自**把想法变成任务。

### 7.6 财务四个限界上下文

用户说的「四个独立数据库」落地为四个域，不是四套登录产品：

| 域 | 表 | 口径 |
|---|---|---|
| 资金账户 | `fin_accounts` | 桶余额 = 期初 + 流水 |
| 资金流水 | `fin_transactions` | 账户进出、转账 |
| 支出统计 | `fin_expenses` | 分类账，可无流水 |
| 收入统计 | `fin_incomes` | 分类账，可无流水 |

设置 `finance.expense_writes_tx=true`（默认）：记支出时同事务写一笔 `direction=out` 流水。关闭则只进分类账。UI 报表同时标明「统计口径」与「账户口径」。

**fin_accounts**

- 通用列（归档=停用，不可物理删 seed）
- `name`, `code` UNIQUE
- `type` (`bucket|cash|bank|other`)
- `currency` DEFAULT `CNY`
- `initial_balance_cents` INTEGER DEFAULT 0
- `note`
- `balance_cached`, `balanced_at`（每次流水后重算）

Seed：

| code | name |
|---|---|
| `love` | 恋爱资金 |
| `emergency` | 紧急资金 |
| `invest` | 投资资金 |

**fin_transactions**

- 通用列
- `account_id`, `direction` (`in|out|transfer`)
- `amount_cents`, `occurred_date`, `occurred_at`, `counterparty`, `note`, `source`
- `transfer_group_id` NULL
- `linked_expense_id` NULL, `linked_income_id` NULL（无 FK）

**转账锁定实现：** 同一 `transfer_group_id` 两行：源账户 `out`，目标账户 `in`，金额相同。禁止单行带 `to_account_id`（v1 方案废弃，避免余额算两次）。

**fin_categories**

- `id`, `domain` (`expense|income`), `name`, `is_system` INTEGER, `sort_order`
- 支出 seed：餐饮、交通、住房、日用、医疗、娱乐、恋爱、学习、数码、其他
- 收入 seed：工资、奖金、副业、投资收益、报销、赠与、其他
- Agent 只能选已有分类；新增走 `categories_create`（低风险 write）

**fin_expenses**

- 通用列 + `row_version`
- `amount_cents`, `occurred_date`（日历日）, `occurred_at`（可选时刻 UTC）
- `category_id`（指向 fin_categories）, `merchant`, `note`, `account_id` NULL
- `tags_json`

「当日」= `occurred_date == today()` 才算普通 write；改历史升格确认票。

**fin_incomes**

- 对称：`category_id`, `amount_cents`, `occurred_date`, `occurred_at`, `account_id` NULL, `note`

P8 才建：`fin_holdings`, `fin_asset_snapshots`, `fin_performance_reviews`。现在不建空表。

**快记预览（无模型）：** Core `financeQuickParse(text)` 用关键词匹配账户名/code、抽取第一个数字为元、剩余作 merchant。只返回预览对象，**不落库**。UI 与 Agent 都可先调预览再 create。这不是 NLP 服务。

### 7.7 健康域

**health_logs** 一天一行，`log_date` UNIQUE

- `id`, `log_date`
- `fasting_weight_kg` REAL NULL
- `sleep_minutes` INTEGER NULL
- `sleep_onset_local` TEXT NULL  -- `HH:MM`，语义见下
- `exercise_text` TEXT NULL
- `note` TEXT NULL
- 通用归档列

**入睡时间归属（锁定）：**

- 一条 `health_logs` = **该 `log_date` 早晨醒来结束的那一觉**，与空腹体重同一天。
- `sleep_onset_local` = 这一觉的入睡钟点（昨晚或今天凌晨）。
- 若凌晨才睡（01:30），仍写在「今天」这条上，值为 `01:30`。
- 合法范围（校验，超出 `VALIDATION`）：本地 `log_date-1 12:00` 到 `log_date 18:00` 之间的钟点。
- `sleep_minutes` 手填，不从入睡反推。MVP 不存起床时间。
- 复盘/首页健康：取 `log_date = 当天` 的行。缺字段写「未知」，禁止编造。

### 7.8 复盘域

**reviews**

- 通用列
- `type` (`daily|period`)
- `period_start`, `period_end`  -- daily 则相等
- `project_id` NULL（阶段复盘可挂项目，无 FK）
- `status` (`draft|final`)
- `mode` (`ai_interview|user_form|ai_from_data`)
- `task_summary_json`, `project_summary_json`, `finance_summary_json`, `health_summary_json`
- `subjective`, `incomplete_reasons`, `tomorrow_adjustments`
- `body_md`
- `interview_json`  -- `[{q, a}]`，提问式
- `generated_by`, `workflow_version_id`, `confirmed_at`

快照 JSON 在 **generate / finalize 时写入**。之后只追加用户文本，**不得**因项目归档而重算快照。归档中心的「历史统计」走快照，不走 live join。

UNIQUE(type, period_start, period_end, project_id) 对 daily 而言即每日一行。

**review_links**（每日复盘可挂多个当日有进展的项目）

- `review_id`, `project_id`
- PRIMARY KEY (review_id, project_id)
- 工作区「复盘」Tab 用此表查询，不靠 JSON 里碰运气

### 7.9 进度计算（Core，事务内）

触发：task / link / milestone / project 写成功后，沿 `parent_id` 向上重算。**禁止 Agent 写 `progress_cached`。** 只计 `role=belongs`。`cancelled` 不进分母；`blocked` 进分母记 0。

```
item_ratio(tasks):
  有 estimate_minutes 则按分钟加权，否则等权
  done=1 其余=0

milestone.progress_cached = item_ratio(挂到该阶段的任务)

project.progress_cached:
  若 progress_manual 非空 → 用之（UI 标明「手动」）
  否则若该项目有阶段：
      各阶段按估时加权平均（无估时等权）
      另设虚拟桶「未分阶段」= belongs 到项目但未挂任何 milestone 的任务
      虚拟桶与真阶段一起加权，避免漏算、也避免 0.7/0.3 把同一批任务算两次
  否则（无阶段）：item_ratio(直接 belongs 到项目的任务)
  无任务无阶段 → 0
  clamp 0..1，4 位小数

依赖：前置未完成而把 to 标 done → 默认拒绝；force=true 走 parked 确认票
```

### 7.10 索引（MVP 就要建）

- `tasks(archived_at, status, scheduled_date)`
- `tasks(due_date)`
- `task_project_links(project_id)`
- `task_milestone_links(milestone_id)`
- `projects(parent_id)`, `projects(archived_at, status)`
- `milestones(project_id)`
- `dependencies(to_type, to_id)`, `dependencies(from_type, from_id)`
- `fin_expenses(occurred_at)`, `fin_incomes(occurred_at)`
- `fin_transactions(account_id, occurred_at)`
- `health_logs(log_date)`
- `reviews(type, period_start)`
- `ideas(archived_at, category)`
- `audit_logs(at)`
- `confirmation_tickets(status, expires_at)`

---

## 8. 页面信息架构

### 8.1 导航

桌面左侧固定：

```
今日
AI 管家
日程          → 默认任务列表；子入口：项目
财务
健康
复盘
想法
归档
设置
```

项目工作区不是一级导航，从 `/projects` 进入 `/projects/:id`。阶段不进顶栏。

手机底栏 5 项：**今日 · 日程 · 财务 · 复盘 · 更多**  
更多：管家、健康、想法、归档、项目、设置。

平板：可折叠左侧栏。

### 8.2 路由

| 路径 | 页面 | MVP |
|---|---|---|
| `/` | 今日总览 | 是 |
| `/butler` | AI 管家（连接/确认/审计；P6 加对话） | 是（无 LLM） |
| `/schedule` | 任务列表 | 是 |
| `/schedule/board` | 静态四列看板（改 status，不拖拽） | 是 |
| `/schedule/calendar` | 月历点选 → 当日任务列表 | 是 |
| `/projects` | 项目树/表 | 是 |
| `/projects/:id` | 项目工作区 | 是 |
| `/finance` | 财务总览 | 是 |
| `/finance/expenses` | 支出 | 是 |
| `/finance/incomes` | 收入 | 是 |
| `/finance/transactions` | 流水 | 是 |
| `/finance/accounts` | 账户 | 是 |
| `/health` | 健康 | 是 |
| `/reviews` | 复盘列表 | 是 |
| `/reviews/daily/:date` | 每日复盘 | 是 |
| `/reviews/period/new` 与 `/reviews/period/:id` | 阶段复盘 | 是（简版） |
| `/ideas` | 想法 | 是 |
| `/archive` | 归档 | 是 |
| `/settings` | 设置 | 是 |
| `/settings/workflows` | 工作模式版本 | 是（简陋） |

### 8.3 全局交互

- 首页只摘要和待处理。
- 普通 create/update（非财务历史）toast 10 秒可补偿 `POST /api/v1/undo/:command_id`。归档、purge、财务历史、升级想法、workflow **无 10 秒撤销**，只走确认票。
- 深色默认；可切浅色。
- 空状态每页自己写一句「下一步做什么」。

### 8.4 视图矩阵（解决 v1 打架）

| 视图 | MVP | P6 |
|---|---|---|
| 任务列表 / 筛选 | 要 | |
| 看板四列改 status | 要（不拖拽、无动画） | 拖拽 |
| 月历点选看当日 | 要（只读 scheduled/due） | 拖到日期 |
| 项目树 | 要 | |
| 项目时间线 | 入口可隐藏 | 要 |
| 工作区 Tab 全套 | 要 | |
| 财务表 + 14 日净额折线 | 要 | |
| 健康 30 日折线 | 要 | |
| 复盘热力日历 | 列表即可 | 热力可做 |
| 甘特 | 不要 | 慎 |

---

## 9. 主要页面线框描述

### 9.1 今日总览 `/`

```
+------------------------------------------------------------------+
| 今日 · YYYY-MM-DD  周X              [快记支出] [记健康] [开始复盘] |
+------------------------------------------------------------------+
| 待处理（有才显示）：N 张确认票 · 复盘草稿 · 计划待确认              |
+--------+--------+--------+--------+-------------------------------+
| 今日任务| 逾期项目 | 昨日净支出| 健康   | 想法提醒（最多 3）        |
+--------+--------+--------+--------+-------------------------------+
| 左：今日计划 早/午/晚 勾选          | 右：昨日复盘一句话 + 链接     |
+------------------------------------------------------------------+
```

**区域：** 顶栏操作、待处理条、5 张摘要卡、计划时间线、昨日复盘。  
**组件：** 卡片、勾选列表、链接按钮。  
**流：** 打开 → 处理确认票 → 勾任务 → 需要时快记/记健康 → 晚上开始复盘。  
**不做：** 项目全树、大表、K 线。

### 9.2 AI 管家 `/butler`（对话页的 MVP 形态）

原始需求的「对话」在 MVP **发生在外部 Agent**。本页是钥匙控制台，避免未接模型时空聊。

```
+------------------------------------------------------------------+
| AI 管家     主：外部 Agent + MCP     辅：页面工作台（P6）          |
+---------------------------+--------------------------------------+
| 连接：serve 端口、token 作用域、   | 待确认卡片：[批准] [拒绝]     |
| 最近一次 MCP 调用时间              | summary 人话                 |
| Skill 路径 skills/paios            |                              |
+---------------------------+--------------------------------------+
| 审计表：时间 | actor | 工具 | 对象 | 结果                          |
| 附录 C 的通用注册说明（不绑厂商）                                  |
+------------------------------------------------------------------+
```

P6 在本页右侧加 Chat：消息 → 服务端用用户配置的 Base URL → 只允许调用 Core 白名单（同 MCP 工具集），系统提示禁止 SQL、禁止把 workflow 标 active。

### 9.3 日程 `/schedule`

顶：列表 | 看板（四列改状态）| 日历（月点选）。  
筛：今天 / 本周 / 收件箱(无项目) / 逾期 / 阻塞。  
表：勾选、标题、项目(可空)、优先级、计划日、截止、状态。  
行点击 → 右侧抽屉：描述、关联、依赖、活动。  
**流：** +任务 → 可选关联项目/阶段 → 保存。

### 9.4 项目列表 `/projects`

树默认。徽章：状态、进度条、可选收益、前置依赖。  
点击进工作区。成环依赖 toast。

### 9.5 项目工作区 `/projects/:id`

```
Tab: 概览 | 阶段 | 任务 | 资料 | 问题 | 复盘 | 收益(benefit_enabled=1 才出现)
```

- 概览：介绍 / 目标 / 实际情况 / 笔记；右侧进度与逾期。
- 阶段：时间线列表；点阶段筛任务。+阶段。
- 任务：仅本项目 `task_project_links`。+任务默认 belongs。
- 资料：标题+URL 列表。
- 问题：open/resolved 列表。
- 复盘：关联本项目的 reviews 摘录。
- 收益：预期/实际/备注；总开关在编辑里。

**流：** 建项目 → 填目标 → 建阶段 → 挂任务 → 必要时加问题/资料。

### 9.6 财务中心 `/finance`

顶：本月支出 / 收入 / 净额 / 三账户余额。  
按钮：+支出 +收入 +转账；快记输入框（预览后确认）。  
四卡片进子页。下：14 日净额折线 + 支出分类 Top5。  
子页：表格 + 筛选 + 顶汇总。账户页三张 seed 卡 + 新增。  
**流：** 选账户与分类 → 填分/元换算由 UI 做、API 只收分 → 保存。

### 9.7 健康 `/health`

今日四字段表单 + 保存。下：体重/睡眠 30 日折线 + 历史表。空字段允许。

### 9.8 复盘 `/reviews`

列表 + 「写今日」+ 「新建阶段复盘」。  
每日编辑三栏：左事实只读（来自 aggregate）；中正文/问答/三个文本区；右想法提醒。  
顶切换模式：用数据生成初稿 | 按问题回答 | 我来填。三种模式同一条 review 记录。  
阶段复盘 MVP：选日期范围（可选项目）→ 同一 aggregate → 一个大 `body_md` + 三文本区。

### 9.9 想法 `/ideas`

分组筛选七类。卡片/表。操作：编辑、归档、升级为任务（对话框，走确认票或 UI confirm 同一 Core）。开关：计划时提醒 / 复盘时提醒。

### 9.10 归档 `/archive`

类型、时间、原因、查询归档内容、恢复、定期清理申请。  
文案写死：定期清理不影响已生成复盘快照；财务默认不可列入清理范围。每周扫描只建确认票，不自动执行。

### 9.11 设置 `/settings`

- 通用：时区、主题、周起始、货币、显示名
- 安全：token 列表、bind、可选启动口令（hash，默认关）
- 备份：立即备份、保留份数、恢复（高风险确认）
- 财务：支出/收入是否写流水、分类列表
- Agent：MCP 说明、当前 token 作用域
- 工作流：各 scope 当前版本、待审、diff、激活、回滚
- 危险：重建进度缓存、申请 purge

### 9.12 视觉

- 字体：系统字体栈；数字表格等宽。
- CSS 变量（锁定）：`--bg:#0f1419` `--bg-elev:#171e26` `--text:#e7ecf1` `--muted:#8b9aab` `--accent:#3d8f7c` `--danger:#d4675c` `--line:#243040`
- 强调色墨绿，不用紫霓虹。深浅两套变量。图表跟主题。
- 桌面紧凑；手机单列。

---

## 10. AI 管家工作流

### 10.1 角色

管家是策略层，Core 是法律层。非法状态进不了库。

### 10.2 每日循环

```
早晨  读 today + health + finance/summary + ideas(remind_in_plan)
      plans_generate → draft → 人在首页确认
白天  勾任务 / 结构化或快记记账 / 记健康；不主动刷屏
晚上  reviews_generate_daily → draft → 人改主观与原因 → finalize
      可选生成次日 plan draft
阶段  人指定区间 → reviews_generate_period
迭代  仅当人说「以后别这么问」→ workflow_propose，不得 auto-activate
```

### 10.3 Skill 置顶硬约束

1. 先读后写。
2. 想法不得擅自变成任务。
3. 没有「改 schema / 改代码」工具，禁止幻想。
4. 财务历史更正、归档、恢复、批量写、workflow 激活、升级想法、purge：确认票；默认 token 不能自己批准。
5. 缺数据写「未知」，禁止编造体重和金额。
6. 遵守当前 `workflow_versions` 的 output_format / schedule_pref。
7. 金额用整数分。

### 10.4 无模型时的管家

规则引擎生成计划草稿和复盘事实初稿。页面管家是控制台。接上 Agent 后文案变好，数据与权限仍由 Core 保证。

### 10.5 每日计划算法（可编码，无 LLM）

函数：`generateDailyPlan(planDate, prefs = schedule_pref.active.spec, filters?: { project_ids, milestone_ids, include_inbox })`

```
1. 若该日已有 confirmed 计划且未传 force → 拒绝；需用户点「重新生成」（parked 票）或只走 plans_update_items
2. 若已有 draft：覆盖生成项，但保留用户手加的 custom_title 项
3. 候选：archived 空，status ∈ {todo, doing}；blocked 仅当 prefs.include_blocked
   且满足任一：scheduled_date=当天 | due_date < 当天（逾期）| due_date=当天
                | 属于 filters.project_ids / milestone_ids
                | include_inbox 且无项目链接的 p0/p1
4. 排除：前置 FS 未完成；已在其他 ≥today 的 confirmed 计划里且未完成
5. 打分：逾期 +100；今日到期 +80；今日已安排 +70；p0 +40 p1 +25 p2 +10 p3 +0
6. 排序后截断 max_items（默认 8）；同一 project 不超过 WIP limit（默认 3）
7. 赋 slot：energy=high → morning（deep work=high 且 estimate≥90，条数 ≤ max_deep_work_blocks）
            energy=low → evening；其余 afternoon；多出的 deep work 改 anytime
8. 想法不进 plan_item；首页另读 remind_in_plan 最多 3 条
9. upsert draft；generated_by=rules
```

Agent 可在 draft 上 `plans_update_items`，人 `plans_confirm`。

### 10.6 每日复盘初稿（可编码）

`aggregateDaily(date)` 只读，返回：

```
tasks: { done, total, overdue, incomplete: [{id,title,status}] }
projects: { touched: [{id,title,progress_cached,delta}] }
finance: { expense_cents, income_cents, net_cents, by_category[], accounts[] }
health: { fasting_weight_kg, sleep_minutes, sleep_onset_local, exercise_text, missing: [] }
ideas: remind_in_review=1 的未归档，最多 5
```

`generateDailyReview(date, mode)`：

- 写入/更新 draft（不覆盖已 final）
- 把 aggregate 结果**深拷贝**进四个 `*_summary_json`
- `body_md` 用模板（见 `skills/paios/references/review-template.md`）：

```
# {date} 每日复盘
## 事实
- 任务：完成 {done}/{total}，逾期 {overdue}。未完成：{titles或「无」}
- 项目：{名称 进度% 或「无变动」}
- 财务：支出 {元} 收入 {元} 净 {元}；缺账则写未知
- 健康：体重/睡眠/入睡/运动，缺则「未知」
## 主观感受
（待填）
## 未完成原因
（列出未完成任务标题，原因待填）
## 明日建议
把未完成且非 cancelled 的任务列入明日候选（只写建议，不自动改计划，除非用户确认）
```

提问式：`questioning.spec.questions` 依次写入 `interview_json`；UI 展示为问答列表（MVP 不是流式聊天）。Agent 可一次填多个 a。

阶段复盘：同一 aggregate，区间求和/列表；模板把「今日」换成「本区间」。

### 10.7 财务快记

`financeQuickParse("咖啡 32 恋爱")` → `{ amount_cents:3200, account_code:"love", merchant:"咖啡", category:"恋爱", confidence:"low" }`  
必须再 `expense_create`。匹配不到账户则 `account_code` 空，UI 要求人选。

---

## 11. MCP 接口设计

MCP 通用服务覆盖：查询数据、创建数据、更新数据、归档和恢复、批量操作、日程规划、财务登记、健康记录、每日复盘、阶段复盘、工作模式迭代、审计日志、权限确认、错误处理。

### 11.1 传输与鉴权

- stdio：`paios mcp`（转发或 in-process）
- Streamable HTTP：仅 `127.0.0.1`，`Authorization: Bearer`
- stdio 也带同一 token（环境变量 `PAIOS_TOKEN`），避免「本机=上帝」
- 默认 seed token：`read,write`。**不含** `confirm` `workflow` `admin`

### 11.2 命名

```
tool:      {domain}_{verb}_{object?}
resource:  paios://{domain}/{...}
domain:    meta|tasks|projects|milestones|plans|ideas|
           finance|health|reviews|archive|workflow|audit
verb:      get|list|create|update|archive|restore|search|
           generate|propose|apply|rollback|confirm|reject|preview
```

禁止物理 `delete_*`。清理只有 `archive_purge_request`。

### 11.3 统一响应

成功：`{ "ok": true, "data": {}, "meta": { "request_id", "actor", "agent_name" } }`

需确认：

```json
{
  "ok": false,
  "error": { "code": "CONFIRM_REQUIRED", "message": "需要你在管家页批准" },
  "confirmation": {
    "ticket_id": "...",
    "summary": "将想法「学日语」升级为任务",
    "expires_at": "..."
  }
}
```

错误码：`NOT_FOUND` `VALIDATION` `CYCLE_DETECTED` `FORBIDDEN` `STALE_VERSION` `CONFLICT` `LOCK_BUSY` `CONFIRM_REQUIRED`

金额：**整数分**。日期：`YYYY-MM-DD`。时间：`HH:MM`。

### 11.4 权限

| scope | 能力 |
|---|---|
| `read` | get/list/search/resources/aggregate/preview |
| `write` | 常规 create/update、**当日**财务登记、健康、计划草稿、复盘草稿、快记预览后的 create |
| `confirm` | 批准/拒绝确认票（默认不给 Agent） |
| `workflow` | propose；apply/rollback 仍要票且建议仅 UI |
| `admin` | 令牌、备份、恢复、bind、purge 执行。不给 Agent |

「当日财务」：`occurred_at` 的本地日 = 今天才算 write；改历史自动升格为确认票。

### 11.5 Tools（MVP 必做标 *）

**meta：** `meta_status*` `meta_whoami*`  
批准确认票 **不是** MCP 工具：Agent 对 `confirm_ticket` 恒 `FORBIDDEN`。UI 走 `POST /api/v1/confirmations/:id/approve`。Agent 可用 `meta_status` / `audit_list` / resource `paios://today` 看到待确认摘要。

**tasks/projects/milestones：**  
`tasks_list*` `tasks_get*` `tasks_create*` `tasks_update*` `tasks_archive*` `tasks_restore*`  
`projects_list*` `projects_get*` `projects_create*` `projects_update*` `projects_archive*` `projects_restore*`  
`projects_get_workspace*` `projects_update_workspace*`  
`project_issues_list/create/update*` `project_links_list/create/update*`  
`milestones_list/create/update*`  
`deps_add*` `deps_remove*`  
`tasks_link_project*` `tasks_unlink_project*`

**plans：** `plans_get*` `plans_generate*` `plans_update_items*` `plans_confirm*`

**ideas：** `ideas_list/create/update/archive*` `ideas_promote_to_task*`（票）

**finance：**  
`finance_accounts_list*`  
`finance_expense_create*` `finance_income_create*` `finance_tx_create*`（含转账两腿）  
`finance_expense_list*` `finance_income_list*` `finance_tx_list*`  
`finance_summary*`  
`finance_preview_nl*`（快记预览，不落库）  
`finance_*_update` 历史 → 票

**health：** `health_get*` `health_upsert*` `health_range*`

**reviews：** `reviews_aggregate*` `reviews_generate_daily*` `reviews_generate_period*` `reviews_update*` `reviews_finalize*`

**archive：** `archive_search*` `archive_restore*`（票）`archive_purge_request*`（只建 job+票）

**workflow：** `workflow_get_active*` `workflow_propose*` `workflow_apply` `workflow_rollback`（后两个票+建议 UI）

**audit：** `audit_list*`

**批量 MVP：** `batch_run*`：`{ items: [{ tool, args }] }` 同事务顺序执行；任一条 `CONFIRM_REQUIRED` 则整批回滚并出一张总票（payload 为 items）。上限 20 条。

### 11.6 Resources

| URI | 内容 |
|---|---|
| `paios://today` | 计划、逾期、待确认、健康、昨日净支出、想法提醒 |
| `paios://inbox/tasks` | 无项目任务 |
| `paios://projects/{id}` | 工作区 + 进度 + 开放问题 + 资料链接 |
| `paios://finance/summary?from&to` | 四域摘要 |
| `paios://health/{date}` | 单日 |
| `paios://reviews/daily/{date}` | 复盘全文 |
| `paios://ideas/active` | 提醒类想法 |
| `paios://workflow/active` | 各 scope 当前 spec |
| `paios://schema/overview` | 实体关系短文，防 Agent 猜模型 |

### 11.7 高风险确认

触发：归档、恢复、想法升级、财务历史改、`batch_run` 含高风险、workflow apply/rollback、purge、force 完成有前置的任务、恢复备份。

流程：Core **只插入** ticket（业务表零行）→ `CONFIRM_REQUIRED` → 人在 `/butler` 或首页点批准 → `executeTicket` 恰好一次。  
TTL：parked 7 天，interactive 30 分钟。过期不执行，可重新提交。  
Agent **不能**批准。默认 token 无 confirm；即使误发带 confirm 的 token，MCP 仍 FORBIDDEN。

### 11.8 Skills 包

```
skills/paios/SKILL.md                 # 一页纸：硬约束 + 工具地图
skills/paios/references/data-model.md
skills/paios/references/finance-rules.md
skills/paios/references/review-template.md
skills/paios/references/agent-setup.md  # 通用注册，不绑厂商
```

禁止 API Key。金额换算写进 Skill：`元 * 100 = cents`。

### 11.9 错误处理

- 可重试：`LOCK_BUSY`、5xx
- 不可重试：VALIDATION、CYCLE、FORBIDDEN、CONFIRM_REQUIRED（应去 UI）
- MCP catch 一切，无堆栈返回
- 每条调用写 audit（read 可抽样，MVP 先全记，后续再限）

---

## 12. AI 自我迭代机制

### 12.1 可变 vs 不可变

| 允许（workflow spec） | 禁止（无工具） |
|---|---|
| 提问方式、复盘流程、日程安排偏好、提醒频率、输出格式、用户偏好、工作流程、任务拆解方式 | 程序代码、数据库核心结构、权限系统、安全策略、财务历史数据、删除规则、管理员权限 |

删除规则与权限不对 Agent 暴露写工具。`workflow_apply` 不能改 schema。

### 12.2 状态机

```
propose → draft → pending_review → active
                       ↘ rejected
active → rolled_back（把指定旧 version 再激活，旧行保留）
```

未知 JSON 字段拒绝。每 scope 独立 version 从 1 起。Seed 为 v1 active。

### 12.3 默认 spec（P0 seed，锁定可编码字段）

**questioning**

```json
{
  "questions": [
    "今天最有进展的一件事是什么？",
    "未完成的任务，主要卡在时间、精力还是依赖？",
    "睡眠和体重有没有需要注意的？",
    "明天只允许三件优先，会选哪三件？"
  ]
}
```

**review_flow**

```json
{
  "prefer_data_draft_first": true,
  "ask_sleep": true,
  "ask_incomplete_reasons": true,
  "auto_finalize": false
}
```

**schedule_pref**

```json
{
  "workday_start": "09:00",
  "workday_end": "18:00",
  "max_items": 8,
  "max_deep_work_blocks": 2,
  "prefer_energy_match": true,
  "include_overdue_first": true,
  "include_blocked": false,
  "respect_project_wip_limit": 3
}
```

**reminder**

```json
{ "plan_morning": true, "review_evening": true, "nag_minutes": 0 }
```

MVP 无推送，`nag_minutes=0` 表示不打扰；字段留下给 P6。

**output_format**

```json
{
  "plan_style": "bullet",
  "review_style": "markdown_sections",
  "language": "zh-CN"
}
```

**user_pref**

```json
{
  "tone": "direct",
  "honorific": false,
  "call_user": "你"
}
```

**workflow**

```json
{
  "morning_order": ["today", "plan_generate", "health_get"],
  "evening_order": ["reviews_aggregate", "reviews_generate_daily"]
}
```

**task_breakdown**

```json
{
  "max_subtasks": 5,
  "default_estimate_minutes": 30,
  "never_auto_create": true
}
```

`never_auto_create=true`：Agent 拆解只能给建议，创建任务需用户在 UI 确认或显式 `tasks_create`（常规写，不算高风险）。Skill 写明：批量拆超过 5 条用 `batch_run` 并先口头确认。

每个 spec 配一份 JSON Schema，放 `packages/api-types/src/workflow-schemas.ts`。propose 必须通过对应 schema。

### 12.4 记录与关键修改

必填：`reason`, `user_feedback`（可空但 UI 鼓励）, `created_by`, 相对上一 active 的 diff。  
关键修改（必须人工、不得一键批）：`auto_finalize` 改 true、`max_items` 变化 ≥50%、`never_auto_create` 改 false、提醒 `nag_minutes`>0。  
其余低风险：设置页可一键激活，仍留版本。

---

## 13. 权限、安全、备份和恢复方案

### 13.1 威胁模型

端口暴露到局域网、Agent 误操作、备份丢失、以后误开隧道。不是多租户。

### 13.2 MVP 措施

- bind 默认 `127.0.0.1`；改 `0.0.0.0` 二次确认
- 浏览器同源 cookie session（serve 托管 dist 时无 CORS）；`pnpm dev` 仅允许 Vite 源
- MCP Bearer token，hash 存库
- Agent 无 admin；默认无 confirm
- 写操作 audit
- 确认票
- `paios.lock` 单实例
- 启动 integrity_check

可选启动口令：默认关（D8 锁定）。

### 13.3 备份

- 手动：设置「立即备份」→ `PRAGMA wal_checkpoint(FULL)` → 生成一致 SQLite 快照到 `backups/YYYYMMDD-HHMMSS.db`；手动、恢复安全和周备份各自最多保留 3 份
- 自动（当前实现）：每次 serve 或直连 MCP 启动按本地时区检查本周周日锚点；缺失时生成经完整性校验的 `weekly-YYYY-MM-DD.db`，只保留最近 3 份；失败不阻止启动，下次启动重试
- 不上传
- 恢复：选文件 → 确认票（人）→ 停写 → 替换 → 要求重启。无 PITR

### 13.4 导出

MVP 文件级备份即验收。JSON/ZIP 后期。

### 13.5 加密

MVP 不做库加密。替代：P8 SQLCipher，或把 `~/.paios` 放到用户已加密盘。

---

## 14. 技术栈比较与推荐

| 方案 | 结论 |
|---|---|
| **Vite React + Hono + Drizzle + SQLite + MCP TS SDK** | **采用** |
| Python FastAPI + React | 备选；两套语言，Tauri 更麻烦 |
| Next.js 全栈 | 不采用（本机 SSR 无价值） |
| Electron | 不采用 |
| 业务写 Rust/Tauri | 不采用；Tauri 只做壳 |
| Postgres | 不采用 |

**锁定版本方向（实施时再钉精确版号，P0 写入 package.json）：**

- pnpm workspace，Node 20+
- React 19 + TS + Tailwind + shadcn/ui + React Router + TanStack Query/Table + Recharts
- Hono + Zod + Drizzle + drizzle-kit
- SQLite：`better-sqlite3`；失败则 `@libsql/client`
- `@modelcontextprotocol/sdk`
- Vitest + Playwright
- 端口 4738

不用页面直连 SQLite：确认票、进度、MCP 会撕裂。

---

## 15. MVP 范围

### 15.1 必须交付

- 本机 Web，深色，左导航，今日总览
- 任务 CRUD；项目树；阶段；task_project_links / task_milestone_links；FS 依赖成环拒绝；自动进度
- 静态看板四列 + 月历点选当日列表
- 工作区：介绍/目标/实际情况/笔记/问题/资料 URL/可选收益
- 规则引擎日计划 + 确认 + 勾选
- 想法 CRUD、七分类、升级确认
- 财务四页、三账户、支出/收入/流水/转账、月摘要、快记预览
- 健康四字段 + 30 日折线
- 每日复盘三模式（提问=问答列表）；阶段复盘简版
- 软归档/恢复/查询归档/归档中心；定期清理（周日扫描）只建 purge 申请，清理前人工确认
- 设置：主题、时区、备份、token、workflow 审阅
- MCP 必做工具 + resources + batch_run + 确认票
- Skills 初版
- 审计 + 管家页
- 单写者进程 + lock + localhost

### 15.2 明确砍掉

页内 LLM、看板拖拽动画、日历拖任务、甘特、附件、投资、习惯饮食心情、独立 NLP、Tauri、i18n、真正执行 purge、AI 改代码。

### 15.3 AI 最低配

无外部模型也能用。接 Agent 后质量提升，对错仍由 Core 管。

---

## 16. 分阶段开发计划

| 阶段 | 周期 | 主题 |
|---|---|---|
| P0 地基 | 3–5 天 | 仓库、迁移、seed、空壳 UI、serve+lock、备份拷贝 |
| P1 日程+想法 | 7–10 天 | 任务项目阶段依赖进度工作区想法 |
| P2 财务健康 | 5–7 天 | 四域+健康+今日卡片+快记 |
| P3 计划复盘归档 | 5–7 天 | 算法计划、日/阶段复盘、归档扫描 |
| P4 MCP+Skill | 5–7 天 | 适配器、工具、五场景 |
| P5 打磨 | 4–6 天 | 工作流 UI、确认中心、深色响应式 |
| **MVP 冻结** | | 第 19 节 |
| P6 | 1–2 周 | 工作台、看板日历时间线、阶段复盘增强 |
| P7 | 1–2 周 | Tauri |
| P8 | 按需 | 投资、习惯、附件、加密、PWA |

单人严格串行 P0→P5。P1/P2 表结构在 P0 一次迁完，避免并行打架。

---

## 17. 每个阶段的输入、输出、依赖和完成标准

### P0 地基

- **输入：** 第 5–7、14 节，附录 A 的路由骨架
- **依赖：** Node 20、pnpm；Windows 若 native 编译失败启用 libsql 替代
- **输出：** monorepo；迁移后含全部 MVP 表；seed 用户+三账户+八个 workflow v1+开发 token；`/` 壳；备份按钮能拷贝 db；`paios.lock`
- **完成标准：** `pnpm dev` 打开今日页；进程监听 127.0.0.1:4738（或 Vite 代理到它）；第二份 `paios serve` 因锁失败

### P1 日程+想法

- **输入：** 7.4–7.5，线框 9.3–9.5、9.9
- **依赖：** P0
- **输出：** 任务/项目/工作区/想法可用
- **完成标准：**
  - 项目→子项目→阶段→任务关联
  - 无项目任务可存在
  - 成环依赖拒绝
  - 完成任务后面进度变化（含父项目）
  - 问题、资料 URL 可增改
  - 想法升级弹确认，取消无新任务
  - `benefit_enabled=0` 时无收益 Tab
  - 看板改 status 与列表一致；月历点某日只列出 scheduled/due 当天的任务

### P2 财务健康

- **输入：** 7.6–7.7，9.6–9.7
- **依赖：** P0（P1 不必完成即可开始，因表已在）
- **输出：** 财务四页、健康页、今日卡片有数
- **完成标准：**
  - 恋爱账户支出 + 联动开 → 余额与月统计同时变
  - 联动关 → 支出增、账户不变
  - 恋爱→紧急转账两腿金额相等、两余额对得上
  - 快记预览「咖啡 32 恋爱」给出 3200 分与 love
  - 连续 3 天体重，折线 3 点
  - 入睡 `01:30` 写在称重日那一行

### P3 计划复盘归档

- **输入：** 第 10、7.8–7.9
- **依赖：** P1+P2
- **输出：** 计划、复盘、归档、用户操作进 audit
- **完成标准：**
  - 生成今日计划含逾期任务；确认后首页展示
  - 复盘只读区与各模块一致；final 后再归档项目，快照数字不变
  - 归档任务主列表消失、归档中心可恢复
  - 提问模式展示 seed 四个问题

### P4 MCP+Skill

- **输入：** 第 11 节、附录 C
- **依赖：** P3
- **输出：** `paios mcp`；Skills；管家页日志
- **完成标准（任意一个 Agent 或 MCP inspector 手工）：**
  1. 读 today 能看到计划
  2. 结构化记 32 元咖啡到恋爱资金
  3. 记体重
  4. 生成复盘草稿
  5. 想法升级返回确认票，未在 UI 批准前无新任务
  6. 第二个 `paios serve` 无法写库

### P5 打磨

- **输入：** 第 9、12、13
- **依赖：** P4
- **输出：** 工作流审阅、确认中心、窄屏底栏、备份恢复文档
- **完成标准：** propose 不能无确认变 active；备份可恢复；宽度 768 导航不崩；关键修改 `auto_finalize` 不能当低风险一键批

### P6–P8

- P6：用户自备 API Base URL + Key；对话只经 Core 白名单
- P7：Windows 安装包，数据在 `%USERPROFILE%\.paios\`
- P8：单独小计划，不预堆表

---

## 18. 测试方案

### 18.1 层次

1. **域测试（Vitest，必须打真实 Core 入口，禁止重写公式）：**
   - `computeProjectProgress`：手动覆盖、无任务、有阶段加权
   - `assertNoCycle`：成环拒绝、合法链通过
   - 归档后月统计仍含已归档支出
   - 转账两腿余额
   - 联动开关
   - 复盘快照不跟随后续记账变化
   - workflow schema 拒绝未知键
   - 确认票过期不执行
   - `generateDailyPlan`：逾期优先、WIP 上限、不覆盖 confirmed
   - `financeQuickParse`：「咖啡 32 恋爱」
   - 第二实例抢锁失败（可测 lock 模块）
2. **API：** 非 localhost bind 拒绝（或需确认）、无 token 的 MCP HTTP 401、历史财务 update 返回 CONFIRM_REQUIRED
3. **MCP 契约：** 每个必做工具名与 schema 快照，防改名
4. **Playwright：** 勾今日任务、工作区加问题、记一笔账、写复盘、归档恢复、备份按钮产生文件
5. **手工钥匙：** P4 五场景；有第二个 Agent 则再跑一遍，没有则记风险
6. **迁移：** 空库升到最新，seed 还在

### 18.2 MVP 不测

性能压测、全量无障碍 AAA、像素回归。做键盘可达与对比度即可。

---

## 19. 验收标准

产品：

1. 断网能：加任务、记账、记体重、写复盘、备份。
2. 首页能回答：今天做什么、钱异常、身体是否已记、待确认。
3. 工作区够写周报，不必翻五个模块。
4. 财务四页对得上，三账户余额能解释。
5. 归档不让旧复盘变空或数字跳动。
6. 新 Agent：只配 MCP + Skill，完成记账+排计划。
7. AI 改不了表结构、已确认历史流水、删除规则。
8. 能回滚 `schedule_pref`，再生成计划条数明显回去。
9. 拷贝 `paios.db` 即迁移（README 有写）。
10. 手机宽能看今日并勾任务（允许简陋）。

工程：P0–P5 完成标准全绿；上述域测试通过；默认不 bind `0.0.0.0`。

---

## 20. 风险清单

| 风险 | 缓解 |
|---|---|
| 大而全 UI | 死守视图矩阵；首页禁止堆模块 |
| 绑死 AI 厂商 | MCP 契约测试；工作台后置且可选 |
| Agent 乱记账/归档 | 默认无 confirm；历史财务升格；审计 |
| SQLite 多进程 | 单写者 + lock；mcp 转发 |
| 四库理解不一致 | 域无跨库 FK；文档口径表 |
| 无 LLM 计划很笨 | 规则引擎保底 |
| Tauri 过早 | P7 才做 |
| 进度不信 | `progress_manual` |
| 快记分类不稳 | 只预览；人改 category |
| 端口改公网 | 二次确认 + 文档 |
| Skill 太长 | SKILL.md 一页纸 |
| Windows native 编译 | libsql 替代 |
| 时区错日 | 日历日只按 timezone 算 |
| 确认票没人点 | 首页+管家黄条；parked 票 7 天，过期不执行、可重新提交 |
| 附件路径 | MVP 不做附件 |

---

## 21. 项目文件结构和文档目录

```
Personal-AI-OS/
  README.md
  docs/
    PLAN.md                    ← 本文件副本
    PRODUCT.md
    ARCHITECTURE.md
    DATA-MODEL.md
    MCP.md
    SKILLS-GUIDE.md
    UI.md
    SECURITY.md
    ROADMAP.md
    DECISIONS.md               ← ADR；D1–D12 首条
    TEST.md
  skills/paios/
    SKILL.md
    references/
  apps/
    web/
    server/                    ← Hono + CLI：serve | mcp
    desktop/                   ← P7 再创建
  packages/
    core/                      ← 领域 + repos 接口 + plan/review 算法
    db/                        ← Drizzle schema + sqlite 实现 + migrations
    api-types/                 ← Zod，REST/MCP/UI 共用
  scripts/
    start.ps1
    dev.ps1
  .data/                       ← gitignore
```

P0 先建 `docs/` 骨架与本计划副本。契约变更：先改 `docs/MCP.md` 再改代码。

包脚本：`pnpm --filter @paios/server serve` / `mcp`；root `pnpm dev` 并行 web+server。

---

## 22. 后续扩展路线

1. 页内工作台（OpenAI 兼容，不绑一家）
2. 看板 / 日历 / 时间线
3. 阶段复盘模板、周提醒
4. 附件资料库
5. 健康：习惯、饮食、心情、指标
6. 投资：持仓、快照、收益率、投资复盘（新表，不动四域）
7. Tauri
8. PWA；远程仅 SSH/隧道 + 强制 token
9. SQLCipher / 加密导出包
10. ICS / 账单 CSV 只读导入
11. FTS
12. 多 Agent 各自 token 与 actor 名

每条单独小计划。禁止顺手重构 Core。

---

## 23. 已锁定的关键决策

原「需要你确认」。按目标要求不再询问，全部采用推荐值。若以后要推翻，写 `docs/DECISIONS.md` ADR，不回头阻塞 P0。

| ID | 决策 | 锁定值 |
|---|---|---|
| D1 | 第一阶段形态 | 本机 Web |
| D2 | 语言栈 | TypeScript 全家桶 |
| D3 | 财务四库物理 | 一个 SQLite，四个限界上下文，无跨域 FK |
| D4 | 支出与流水 | 默认联动，可关 |
| D5 | 页面 AI 工作台 | P6，不进 MVP |
| D6 | 计划/复盘生成 | 规则模板保底，LLM 靠外部 Agent |
| D7 | 金额 | 库内与 API 均为整数分 |
| D8 | 本机口令 | 可选，默认关 |
| D9 | 项目收益 | `benefit_enabled` 默认 0 |
| D10 | 确认票批准 | **仅 UI**；MCP 批准恒 FORBIDDEN；parked 7 天 |
| D11 | 数据目录 | 开发 `.data/`，正式 `~/.paios/` |
| D12 | 投资表 | 现在不建 |

额外锁定：端口 `4738`；单写者；转账两腿；入睡归属称重日；看板/日历 MVP 静态；业务行永不物理删；确认仅 UI。

---

## 最终方案（收束）

做本地单用户个人 OS，不做聊天 App。

- **身体：** SQLite + React 分页界面，首页只摘要。
- **钥匙：** 稳定 MCP + 短 Skill，stdio 适配器不碰数据库。
- **管家：** 外部 Agent 为主；页内工作台可关、可换。
- **形态：** 先 Web 后 Tauri，业务写一次。
- **智能边界：** AI 进化工作方式，不进化系统本身，不改历史账。
- **交付：** P0–P5 到 MVP；验收看断网能用、换 Agent 能记账排计划、归档不毁复盘。

---

## 附录 A — REST `/api/v1` 目录（MVP）

统一：JSON；写操作 `application/json`；错误 `{ ok:false, error:{ code, message }, confirmation? }`。

```
GET    /today
GET    /tasks                    query: status, date, inbox, project_id, archived
POST   /tasks
GET    /tasks/:id
PATCH  /tasks/:id
POST   /tasks/:id/archive
POST   /tasks/:id/restore
POST   /tasks/:id/links
DELETE /tasks/:id/links/:linkId

GET    /projects
POST   /projects
GET    /projects/:id
PATCH  /projects/:id
GET    /projects/:id/workspace
PATCH  /projects/:id/workspace
GET|POST /projects/:id/issues
PATCH  /issues/:id
GET|POST /projects/:id/links
PATCH  /project-links/:id
POST   /projects/:id/archive|restore

GET|POST /milestones
PATCH  /milestones/:id

POST   /deps
DELETE /deps/:id

GET    /plans/:date
POST   /plans/:date/generate
PATCH  /plans/:date/items
POST   /plans/:date/confirm

GET|POST /ideas
PATCH  /ideas/:id
POST   /ideas/:id/promote
POST   /ideas/:id/archive

GET    /finance/summary
GET|POST /finance/accounts
GET|POST /finance/expenses
GET|POST /finance/incomes
GET|POST /finance/transactions          # transfer: { from, to, amount_cents }
POST   /finance/preview

GET    /health/:date
PUT    /health/:date
GET    /health?from&to

GET    /reviews
POST   /reviews/daily/:date/generate
PATCH  /reviews/:id
POST   /reviews/:id/finalize
POST   /reviews/period

GET    /archive
POST   /archive/restore
POST   /archive/purge-request

GET    /confirmations
POST   /confirmations/:id/approve
POST   /confirmations/:id/reject

GET    /audit
GET    /workflows
POST   /workflows/propose
POST   /workflows/:id/apply
POST   /workflows/:id/rollback

GET    /settings
PATCH  /settings
POST   /system/backup
POST   /system/restore
GET    /system/status
POST   /batch
```

---

## 附录 B — 枚举中文

| 枚举 | 展示 |
|---|---|
| task status | 待办 / 进行中 / 完成 / 阻塞 / 取消 |
| project status | 构想 / 已规划 / 进行中 / 暂停 / 完成 / 放弃 |
| idea category | 项目灵感 / 短期想法 / 长期目标 / 生活事项 / 学习方向 / 待观察 / 暂不执行 |
| priority | P0–P3 |
| ticket | 待确认 / 已批准 / 已拒绝 / 已过期 / 已执行 |

---

## 附录 C — 多 Agent 注册（通用，不绑厂商）

任何支持「本地 stdio MCP」的工具，使用同一形态：

```json
{
  "mcpServers": {
    "paios": {
      "command": "pnpm",
      "args": ["--filter", "@paios/server", "mcp"],
      "env": {
        "PAIOS_URL": "http://127.0.0.1:4738",
        "PAIOS_TOKEN": "<从 .data/mcp-token.txt 复制>"
      }
    }
  }
}
```

把 `skills/paios` 加入该 Agent 的 skill 搜索路径（各产品文件名不同，只在 `agent-setup.md` 列指针，不在核心契约里写死）。

要求：先 `paios serve` 再开 Agent。若只开 mcp 且无锁，mcp 可内嵌 Core（仍单进程）。

---

## 附录 D — P0 开工清单（执行顺序）

1. pnpm workspace + apps/web, apps/server, packages/{core,db,api-types}
2. Drizzle schema 按第 7 节一次建齐 + 索引
3. seed：local 用户、三账户、分类 settings、八 workflow v1、开发 token
4. serve：bind 127.0.0.1:4738、lock、integrity_check、托管空 dist
5. `GET /api/v1/today` 返回空结构
6. Web 壳：深色、左导航、今日空状态
7. 设置页备份拷贝
8. 域测试：lock、seed、integrity 占位
9. 把本计划复制为 `docs/PLAN.md`，ADR 写入 D1–D12

完成以上即 P0 可验收，再进入 P1。
