# 4. AI、MCP、对话图片、统计预留

## 4.1 调用关系（第一版）

```
用户
 ├─ Web 资料区 ──REST──► Core ──► SQLite
 ├─ Web 管家页 ──REST /butler/chat + conversations ──► 用户自备 LLM
 │                         │
 │                         └─ 只读写对话；不自动调 MCP 工具
 └─ 外部 Agent（Claude/Codex/Grok…）
        Skill skills/paios
        MCP stdio → REST → Core → SQLite
```

页内管家**不是**第二个 MCP 客户端。它只是 OpenAI 兼容 chat。项目设计、记账、复盘若要结构化写入，走：

1. 用户自己在对应页面改，或  
2. 外部 Agent 按 Skill 调 MCP

这样不破坏「Agent 不能批准确认票、不能改 schema」。

## 4.2 项目设计台如何触发 Agent

详情页设计台是「绑定了 `project_id` 的管家对话」。点「生成项目上下文」把只读摘要插入一条 user 消息，例如：

```
当前项目：{name}
状态：{status} 类别：{category}
目标日期：{target_date}
目标结果：{target_result}
阶段：...
未完成任务：...
请给出：目标修订、阶段划分、本周执行步骤。不要声称已经改库。
```

用户把方案贴回资料区，或切换到外部 Agent 让它用 MCP 写 `milestones` / `tasks`。

Skill 增补一节「项目设计」：先 `GET /projects/:id`（经 `batch_run`），再小步创建阶段和任务，关联 `project_id`。不新增 MCP 工具也能做；若 `batch_run` 不够用再加只读 `projects_get`。第一版**加**这些 MCP 工具（只读 + 普通写，无 approve）：

| 工具 | REST |
| --- | --- |
| `projects_list` | `GET /projects` |
| `projects_get` | `GET /projects/:id` |
| `ideas_list` | `GET /ideas` |
| `ideas_create` | `POST /ideas` |
| `health_put` | `PUT /health/:date` |
| `reviews_list` | `GET /reviews` |

高风险（promote、restore、purge、workflow apply）仍然禁止出现在 MCP 工具表。`batch_run` 继续拦截 `/confirmations/*/approve`。

## 4.3 管家消息与图片

发送路径：

1. 前端可选 `POST /attachments`（multipart），得到 id  
2. `POST /conversations/:id/messages` `{ content_text, attachment_ids }` 先存 user 行  
3. 服务端组 OpenAI messages：  
   - system = `butlerSystemPrompt()` + 今日日期 + 待确认数 +（若有 project_id）项目摘要  
   - 最近 N 条（默认 20）历史  
   - 本条 user：纯文本，或 `[{type:text},{type:image_url: data URL 或本机不可用则跳过}]`  
4. 因本机图片 LLM 不一定能拉 `127.0.0.1` 附件 URL，**把图片转成 data URL 再发给模型**，但 data URL 不写进 sqlite，sqlite 只存 attachment id  
5. 助手文本落库  
6. 返回新消息

复制：前端把当前对话所有 `content_text` 按「你/管家」拼到剪贴板。图片用文件名列表。

新建对话：`POST /conversations`，hash 跳到 `#/butler/:id`。

归档/恢复：左栏可筛「已归档」；恢复后回到活跃列表。

API 配置只在设置页。管家页没有 Base URL/Key 输入框。

Key 读取顺序：`secrets.json` → `PAIOS_LLM_API_KEY` 环境变量。请求 body 里不再接受 `api_key`（避免 key 进审计）。现有 butler 测试改为写临时 secrets 文件。

## 4.4 图片约束

- 最多 4 张 / 条消息  
- 每张 ≤ 4MB  
- MIME 白名单 jpeg/png/webp/gif  
- 不生成缩略图（YAGNI）  
- 附件不可被 MCP 读取文件字节，只在 Web 对话里用  

## 4.5 Skill 更新

`skills/paios/SKILL.md` 增加：

- 想法列表与紧急程度  
- 项目画廊字段含义  
- 财务必须带 major/minor，金额整数分  
- 健康新字段  
- 对话存在 Web，Agent 不要幻想自己能看到用户在管家页发的图片，除非以后做同步（第一版不同步）

`references/agent-setup.md` 不变。

## 4.6 统计预留

UI：财务第五 tab、健康页右上「趋势（即将提供）」、复盘页「周/月摘要（即将提供）」。都不可点入计算。

API：`GET /api/v1/stats` 永远 `available: false`，不查聚合。这样前端可以先接好，第二版再算：

- 财务：本周/月收支、按大项汇总  
- 健康：平均睡眠、运动总分钟、自律天数  
- 复盘：问题字段的简单计数  

统计只出摘要，SQL 不 DELETE。

## 4.7 审计

对话发送记 `audit_logs.action = POST /api/v1/butler/chat`，`request_json` 不含 key、不含图片字节。附件只记 id 与 byte_size。
