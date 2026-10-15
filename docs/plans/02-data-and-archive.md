# 2. 数据模型、归档状态机、迁移

金额继续用整数分。日期继续用用户本地日历日 `YYYY-MM-DD`。业务行只软归档，禁止物理删除。财务四域之间仍然不建 SQLite FK。

当前 `openDatabase` 只执行 `CREATE TABLE IF NOT EXISTS`，**没有迁移版本**。本计划补 `schema_migrations` 表。

## 2.1 字段映射（UI ↔ 存储）

### 任务 `tasks`

| UI | 存储 | 规则 |
| --- | --- | --- |
| 归档 checkbox | `archive_requested` INTEGER 0/1 | 勾选只表示「请求归档」 |
| 任务名称 | `title` | 必填，1–200 |
| 任务日期 | `due_date` | 可空；列表按 `due_date DESC`，空日期垫底 |
| 状态 | `status` | 见状态映射 |
| 备忘 | `description` | 可空 |

内部仍保留 `priority`、`scheduled_date`、`estimate_minutes`、`energy`。第一版 UI 不展示。`scheduled_date` 继续给今日计划和日历用，不出现在任务表列。

状态映射：

| UI | `status` |
| --- | --- |
| 未完成 | `todo`（写入默认） |
| 完成 | `done` |
| 取消 | `cancelled` |

读时：`doing`、`blocked` 在表里显示为「未完成」，保存成 `todo`（第一版不保留进行中/阻塞）。看板不在任务页出现。

自动归档：

```
archive_requested = 1 AND status IN ('done', 'cancelled')
  → 写 archived_at = now, archive_reason = 'auto', archived_by = 'user'
否则即使勾选归档，行仍留在任务页。
```

取消勾选且尚未写入 `archived_at`：只清 `archive_requested`。  
已归档行只能在归档页恢复：`archived_at=NULL, archive_requested=0`。

### 想法 `ideas`

| UI | 存储 |
| --- | --- |
| 归档 checkbox | `archive_requested` |
| 想法内容 | `title` |
| 类型 | `category`：`project` / `long_term` / `short_term` |
| 备注 | `body` |
| 紧急程度 | `urgency` INTEGER 1/2/3/4，默认 4 |
| 处理状态 | `processed` INTEGER 0/1，默认 0 |

旧 `status`（`inbox|considering|promoted|archived`）保留给「升级为任务」流程：未处理=`inbox`，已处理且已升级=`promoted`。UI 不直接编辑旧 `status`。

类型映射：`project` 项目灵感，`long_term` 长期想法，`short_term` 短期想法。库里已有的 `life|learning|observe|defer` 读出来显示为「短期想法」，保存时改成 `short_term`。

排序：`urgency ASC, created_at DESC`（1 级最上）。

自动归档：`archive_requested=1 AND processed=1` → 写 `archived_at`。

升级为任务：仍走确认票，Agent 不能批准。升级成功后 `processed=1, promoted_task_id=...`，不自动归档，除非用户同时勾了归档。

### 项目 `projects`

| UI | 存储 |
| --- | --- |
| 项目名称 | `name` |
| 启动时间 | `started_at` TEXT `YYYY-MM-DD`，可空 |
| 项目类别 | `category`：`small` / `mid` / `long` |
| 当前状态 | `status` 见映射 |
| 目标日期 | `target_date` |
| 目标结果 | `target_result` TEXT |
| 预期收益 | `benefit_cents`（可空，整数分） |
| 收益属性 | `benefit_kind`：`none` / `possible` / `certain` |

状态映射：

| UI | `status` |
| --- | --- |
| 准备开始 | `planned`（新建默认；旧 `idea` 读作准备开始） |
| 进行中 | `active` |
| 完成 | `done` |

`paused`、`abandoned` 第一版 UI 不提供选项，已有数据读成「准备开始」/`paused` 用灰色标签「暂停」但不作为可选项。归档页仍能看到。

`benefit_kind=none` 时 `benefit_enabled=0`，卡片上预期收益显示「—」。  
`possible|certain` 时 `benefit_enabled=1`。

项目归档：**手动**。详情页或卡片菜单「归档」。不要求状态=完成。对话同理，手动归档。

工作区 `project_workspaces` 继续用：介绍、目标、现状、备注。详情页「资料」读写这些字段 + issues + links + milestones。

### 财务

支出 `finance_expenses`、收入 `finance_incomes` 各加：

- `category_major` TEXT
- `category_minor` TEXT
- `project_id` TEXT 可空（不建 FK）
- `event` TEXT 可空（「午餐」这类事件名；`note` 继续当备注）

旧 `category` 保留，写入时同步为 `major/minor`，旧数据迁移时：若 `category` 能匹配小项则拆开，否则 `major=其他` 或按收支默认大项，`minor=其他`，`event=原 category`。

账户显示名：

| id | 新显示名 | 颜色 |
| --- | --- | --- |
| `love` | 恋爱资金 | 粉 |
| `emergency` | 紧急资金 | 红 |
| `daily` | 投资资金 | 蓝 |

id 不改，避免打乱已有流水。seed 时更新 `name`。

快捷按钮不进业务表，进 `app_settings['finance.quick_buttons']` JSON。默认按钮见 03。

财务、健康、复盘**没有** `archive_requested` 业务含义；已有 `archived_at` 列保持不用。归档页不列出它们。

### 健康 `health_logs`

每日期一行（已有 `log_date UNIQUE`）。

| UI | 存储 |
| --- | --- |
| 日期 | `log_date` |
| 今日空腹体重 | `weight_kg` |
| 昨晚睡觉时间 | `bedtime_local` `HH:MM` |
| 入睡时间 | `sleep_onset_local` `HH:MM` |
| 起床时间 | `wake_local` `HH:MM` |
| 睡眠时间 | `sleep_duration_minutes` 整数；若入睡+起床都有则服务端重算 |
| 今日运动内容 | `exercise_note` |
| 运动时长 | `exercise_minutes` |
| 是否自律 | `disciplined` INTEGER 0/1 可空 |
| 备注 | `note` |

入睡归属规则不变：记在称体重的那天。

睡眠分钟计算：起床减入睡，若起床更早则加 24h。只在两个时刻都合法时覆盖 `sleep_duration_minutes`；否则用用户手填。

### 复盘 `reviews`

不改表结构。把规格字段放进 `content_json`，并约定稳定 key：

每日 `review_type=daily`：

```json
{
  "plan_text": "",
  "ai_observation": "",
  "went_well": "",
  "problems": "",
  "conclusion": "",
  "tomorrow_adjust": "",
  "workflow_feedback": "",
  "data": {}
}
```

`status`：`draft` = 草稿，`finalized` = 已完成。

阶段 `review_type=period`：

```json
{
  "project_id": "",
  "goal_result": "",
  "keep_stop_adjust": "",
  "conclusion": ""
}
```

`period_start` / `period_end` 已有。UI「待复盘」=`draft`，「已完成」=`finalized`。

### 管家对话（新表）

```sql
CREATE TABLE IF NOT EXISTS conversations (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL DEFAULT '新对话',
  project_id TEXT,
  archived_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS conversation_messages (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
  content_text TEXT NOT NULL DEFAULT '',
  attachments_json TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS attachments (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL,
  message_id TEXT,
  filename TEXT NOT NULL,
  mime TEXT NOT NULL,
  byte_size INTEGER NOT NULL,
  relpath TEXT NOT NULL,
  created_at TEXT NOT NULL
);
```

图片文件落在 `{dataDir}/attachments/{conversationId}/{attachmentId}`，不进 SQLite BLOB。单张上限 4MB，只允许 `image/jpeg|png|webp|gif`。

API Key **不进** `app_settings`、不进 `paios.db`。写入 `{dataDir}/secrets.json`：

```json
{ "llm_api_key": "sk-..." }
```

`GET /workbench/config` 只返回 `has_api_key: true|false`，永不回明文。

## 2.2 归档状态机

### 任务

```
新建: archive_requested=0, archived_at=NULL, status=todo
  │
  ├─ 勾选归档 + 未完成 → 仍在任务页（checkbox 保持勾，不进归档库）
  ├─ 改为完成/取消 + 未勾归档 → 仍在任务页
  └─ 勾选归档 + (完成|取消) → archived_at 写入，任务页消失，归档页出现
恢复: archived_at=NULL, archive_requested=0, 回到任务页
```

Core 函数（放 `packages/core`，单测覆盖）：

```ts
export function shouldArchiveTask(row: { archive_requested: number; status: string; archived_at: string | null }): boolean {
  if (row.archived_at) return false;
  return row.archive_requested === 1 && (row.status === "done" || row.status === "cancelled");
}
```

PATCH 任务后必须调用，不能只靠前端。

### 想法

```
shouldArchiveIdea = archive_requested===1 && processed===1 && archived_at==null
```

### 项目 / 对话

仅手动 `POST .../archive`。恢复走归档页统一 `POST /api/v1/archive/restore`。

### 明确不做

- 归档页无删除、无 purge UI（后端 purge 票保留但不暴露按钮）
- 财务/健康/复盘不出现在归档页
- 统计不删除原始行

## 2.3 迁移

`packages/db/src/index.ts` 的 `openDatabase`：

1. `exec(INITIAL_SCHEMA_SQL)`（新库）
2. 确保 `schema_migrations(id INTEGER PRIMARY KEY, name TEXT NOT NULL UNIQUE, applied_at TEXT NOT NULL)`
3. 按文件名顺序跑未应用迁移
4. 再 `seedDatabase`（`INSERT OR IGNORE` + 账户改名 UPDATE）

迁移目录：`packages/db/src/migrations/`。

`001_ui_restructure.sql` 逻辑（SQLite 无 `ADD COLUMN IF NOT EXISTS`，用 `PRAGMA table_info` 在 TS 里逐列补）：

```
tasks: archive_requested INTEGER NOT NULL DEFAULT 0
ideas: archive_requested INTEGER NOT NULL DEFAULT 0
ideas: urgency INTEGER NOT NULL DEFAULT 4
ideas: processed INTEGER NOT NULL DEFAULT 0
projects: category TEXT NOT NULL DEFAULT 'mid'
projects: started_at TEXT
projects: target_date TEXT
projects: target_result TEXT NOT NULL DEFAULT ''
projects: benefit_kind TEXT NOT NULL DEFAULT 'none'
finance_expenses / finance_incomes:
  category_major, category_minor, project_id, event
health_logs:
  bedtime_local, wake_local, exercise_note, exercise_minutes, disciplined
conversations / conversation_messages / attachments / schema_migrations
```

数据回填：

- `ideas.status IN ('promoted','archived')` → `processed=1`
- `ideas.archived_at IS NOT NULL` → `archive_requested=1`
- `tasks.archived_at IS NOT NULL` → `archive_requested=1`
- `projects.benefit_enabled=0` → `benefit_kind='none'`；`=1` → `certain`（旧数据无「可能」）
- `projects.status='idea'` 保持原值，UI 映射为准备开始
- 支出 `category` 能命中小项字典则拆 major/minor，否则 `日常消费/其他`（支出）或 `突发/其他收入/其他`（收入）
- 账户改名：`love→恋爱资金`，`emergency→紧急资金`，`daily→投资资金`
- seed `finance.quick_buttons`、`finance.default_account_id='love'`

回滚：不提供 down。失败则用户用备份恢复。迁移前可调用已有 `createBackup`。

开发库 `.data/paios.db` 和生产 `%USERPROFILE%\.paios\paios.db` 走同一套迁移。
