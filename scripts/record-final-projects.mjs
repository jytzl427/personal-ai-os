import Database from "file:///C:/Users/jytzl/.paios/desktop-runtime/resources/paios-server/node_modules/better-sqlite3/lib/index.js";
import { randomUUID } from "node:crypto";

const dbPath = "C:/Users/jytzl/.paios/paios.db";
const db = new Database(dbPath);

console.log("Recording Personal AI OS and Tech Creator Agent...");

db.transaction(() => {
  // ================= 1. PERSONAL AI OS =================
  const paiosId = randomUUID();
  const paiosNotes = `### 🌟 Personal AI OS 核心演进脉络与全版本蓝图（v1.0 ~ v2.1）

一套本地离线优先、全周期规范咬合的个人 AI 操作系统（Personal AI OS）。

| 版本里程碑 | 攻坚周期 | 核心架构与业务系统交付 | 验收状态 |
| :--- | :--- | :--- | :--- |
| **v1.0 规范底盘** | 2026.09.01 ─ 2026.09.15 | **三大规范体系与业务底盘**<br>• 制定三大计划与复盘原则（阶段计划、每日计划、每日复盘与阶段复盘铁律）<br>• 落地待办任务、财务双轨记账、健康称重/睡眠数据底座与 SQLite WAL 存储 | **✓ 验收通过** |
| **v1.1 界面与动效** | 2026.09.16 ─ 2026.09.30 | **极简高质感微动效与交互打磨**<br>• 交互精细化重构：数据可视化看板、状态条纹感知与移动端自适应布局<br>• 优化快速记账预设、分类树与注意力横幅动态提醒机制 | **✓ 验收通过** |
| **v2.0 独立桌面端** | 2026.10.01 ─ 2026.10.15 | **Tauri 2.0 桌面端与双向 MCP 协议**<br>• Windows 桌面原生封装（Tauri 2.0），内置嵌入式 Node.js 独立运行环境<br>• 原生双向 MCP 协议（Stdio / Direct HTTP），打通与 Claude、Codex、Antigravity 代理协同 | **✓ 验收通过** |
| **v2.1 推进闭环升级** | 2026.10.16 ─ 2026.10.21 | **甘特时间轴、行动卡槽与智能联动**<br>• 推进项目甘特时间轴与方案 B 行动卡槽升级，阶段卡片流自适应排版<br>• 落地属性实时自动保存、日历一键清除、验收节点自由调序（▲/▼）<br>• 历史完结项目一键唤醒机制、2 天内节点自动同步待办任务、可折叠左侧导航栏 | **✓ 验收通过** |
`;

  db.prepare(`
    INSERT INTO projects (
      id, name, description, status, priority, progress_manual,
      benefit_enabled, benefit_cents, category, started_at, target_date,
      end_date, target_result, benefit_kind, archive_requested, row_version,
      created_at, updated_at
    ) VALUES (
      ?, ?, ?, 'done', 'P2', 100,
      0, NULL, 'advancement', '2026-09-01', '2026-10-21',
      '2026-10-21', ?, 'none', 0, 1,
      '2026-09-01T09:00:00.000Z', '2026-10-21T01:00:00.000Z'
    )
  `).run(
    paiosId,
    "Personal AI OS",
    "本地单机部署、隐私优先的个人 AI 操作系统。整合本地 SQLite 数据库、Hono RESTful API、Tauri 2.0 桌面原生宿主与双向 MCP 协议服务端。历经规范打磨、UI 微动效重构、原生桌面端独立封装到推进项目时间轴/行动卡槽/临期联动等全链路功能演进。",
    "打造一套本地离线优先、全周期规范咬合的个人 AI 操作系统（三大核心底盘：阶段与每日计划/复盘系统、双向 Agent-Native 协作底座、Tauri 桌面原生客户端），实现多 Agent 权限沙箱隔离、双向 MCP 协议联动与全自动化资产/健康/任务数字化管理。"
  );

  db.prepare(`
    INSERT INTO project_workspaces (
      project_id, introduction, goals, current_situation, notes, updated_at
    ) VALUES (
      ?, ?, ?, ?, ?, '2026-10-21T01:00:00.000Z'
    )
  `).run(
    paiosId,
    "本地单机部署、隐私优先的个人 AI 操作系统。",
    "三大底盘：阶段与每日计划/复盘系统、双向 Agent-Native 协作底座、Tauri 桌面原生客户端。",
    "已圆满完成 v1.0、v1.1、v2.0、v2.1 四大版本全套工程研发，系统高度稳定成熟，已成为日常生活与技术攻坚的数字化中枢底座。",
    paiosNotes
  );

  const paiosCheckpoints = [
    { title: "v1.0 规范底盘：三大计划复盘规范与业务数据基底", desc: "确立三大计划复盘规范体系（阶段计划、每日计划、每日复盘与阶段复盘铁律），落地待办、财务、健康底盘与 SQLite WAL 架构。", due: "2026-09-15", sort: 1 },
    { title: "v1.1 界面重构：数据看板、状态感知与交互细节打磨", desc: "交互精细化重构：数据可视化看板、状态条纹感知与移动端自适应布局，优化快速记账预设与注意力横幅提醒。", due: "2026-09-30", sort: 2 },
    { title: "v2.0 桌面端封装：Tauri 2.0 与双向原生 MCP 协议", desc: "Windows 桌面原生封装（Tauri 2.0），内置嵌入式 Node.js 独立运行环境，支持 Stdio/Direct HTTP 双向原生 MCP 协议。", due: "2026-10-15", sort: 3 },
    { title: "v2.1 推进闭环：行动卡槽、自动保存、临期联动与收起侧栏", desc: "推进项目甘特时间轴与方案 B 行动卡槽升级，落地属性自动保存、日历一键清除、节点调序（▲/▼）、完结项目唤醒、2天内节点同步待办与可收起侧栏。", due: "2026-10-21", sort: 4 }
  ];

  for (const cp of paiosCheckpoints) {
    db.prepare(`
      INSERT INTO project_task_plans (
        id, project_id, title, description, due_date, status,
        completed_at, todo_task_id, sort_order, row_version, created_at, updated_at
      ) VALUES (
        ?, ?, ?, ?, ?, 'done',
        ?, NULL, ?, 1, ?, ?
      )
    `).run(
      randomUUID(),
      paiosId,
      cp.title,
      cp.desc,
      cp.due,
      `${cp.due} 18:00:00`,
      cp.sort,
      `${cp.due}T09:00:00.000Z`,
      `${cp.due}T18:00:00.000Z`
    );
  }

  const paiosLogs = [
    { at: "2026-09-01T09:00:00.000Z", kind: "milestone", content: "🚀 Personal AI OS 正式立项启动，明确个人数字操作系统架构" },
    { at: "2026-09-15T18:00:00.000Z", kind: "task_completed", content: "✓ 完成 v1.0 验收：三大计划复盘规范与业务底座落地" },
    { at: "2026-09-30T18:00:00.000Z", kind: "task_completed", content: "✓ 完成 v1.1 验收：界面重构与数据看板体验优化通过" },
    { at: "2026-10-15T18:00:00.000Z", kind: "task_completed", content: "✓ 完成 v2.0 验收：Tauri 2.0 桌面端与双向 MCP 协议支持通过" },
    { at: "2026-10-21T01:00:00.000Z", kind: "task_completed", content: "✓ 完成 v2.1 验收：甘特时间轴、行动卡槽、属性自存、临期联动与侧栏收缩圆满收官" }
  ];

  for (const log of paiosLogs) {
    db.prepare(`
      INSERT INTO project_activity_logs (
        id, project_id, kind, content, important, created_at
      ) VALUES (
        ?, ?, ?, ?, 1, ?
      )
    `).run(randomUUID(), paiosId, log.kind, log.content, log.at);
  }

  // ================= 2. TECH CREATOR AGENT =================
  const tcaId = randomUUID();
  const tcaNotes = `### 🌟 Tech Creator Agent 核心演进脉络与全版本蓝图（v1.0 ~ v4.2）

专为 Codex、Claude Code、Antigravity 等 Agent 调用的本地化技术内容创作与分发工业化管家。

| 版本里程碑 | 攻坚周期 | 核心架构与业务系统交付 | 验收状态 |
| :--- | :--- | :--- | :--- |
| **v1.0 画像与事实卡片** | 2026.09.10 ─ 2026.09.20 | **项目文档解析与创作者画像**<br>• 本地代码与文档智能解析导入，提取代码事实与工程逻辑<br>• 创作者画像建模，生成真实可信的事实卡片、选题与草稿原型 | **✓ 验收通过** |
| **v2.0 ~ v2.3 采编与审稿** | 2026.09.21 ─ 2026.09.30 | **热点雷达与双阶段审稿流水线**<br>• RSS + Firecrawl CLI 本地网页热点采集雷达<br>• 双阶段专业编委会审稿机制（一审事实核对、二审文笔调优、主编裁决与非破坏性修改提案） | **✓ 验收通过** |
| **v3.0 Agent-Native 转型** | 2026.10.01 ─ 2026.10.10 | **去前端化，以 Agent 对话与工具为中心**<br>• 彻底摒弃传统繁琐前端依赖，转向纯粹的 Agent-Native 架构<br>• 建立确定性的本地 SQLite 记忆库与严密的工具调用状态断言 | **✓ 验收通过** |
| **v4.0 ~ v4.2 分发与复盘** | 2026.10.11 ─ 2026.10.18 | **双平台排版分发、指标复盘与全能力 MCP 接口**<br>• 知乎与微信公众号双平台自适应排版生成与一键分发准备<br>• 发布后阅读量、点赞、收藏等量化指标登记与自适应分析复盘<br>• 100% Agent-Native MCP 工具链接入（Codex / Claude / Antigravity 原生调用） | **✓ 验收通过** |
`;

  db.prepare(`
    INSERT INTO projects (
      id, name, description, status, priority, progress_manual,
      benefit_enabled, benefit_cents, category, started_at, target_date,
      end_date, target_result, benefit_kind, archive_requested, row_version,
      created_at, updated_at
    ) VALUES (
      ?, ?, ?, 'done', 'P2', 100,
      0, NULL, 'advancement', '2026-09-10', '2026-10-18',
      '2026-10-18', ?, 'none', 0, 1,
      '2026-09-10T09:00:00.000Z', '2026-10-18T22:00:00.000Z'
    )
  `).run(
    tcaId,
    "Tech Creator Agent",
    "专为 Codex、Claude Code、Antigravity 等 Agent 调用的本地内容创作服务。保存创作者画像、项目素材、事实卡片、选题草稿、热点雷达、审稿编委会记录和发布数据复盘，并通过原生 MCP 协议提供工业级内容创作能力。",
    "构建一套基于本地项目的全自动 AI 内容创作者管家，打通从项目解析、热点采编、双平台内容分发到双审流水线与数据复盘的全链路自媒体工业化闭环，实现 100% Agent-Native 原生工具集成。"
  );

  db.prepare(`
    INSERT INTO project_workspaces (
      project_id, introduction, goals, current_situation, notes, updated_at
    ) VALUES (
      ?, ?, ?, ?, ?, '2026-10-18T22:00:00.000Z'
    )
  `).run(
    tcaId,
    "专为 AI Agent 调用的本地优先内容创作服务。",
    "工业化自媒体全链路闭环：画像建模、热点采编、双审编委会、双平台排版与指标复盘。",
    "已圆满完成 v1.0 至 v4.2 全量迭代演化，全能力通过 MCP 协议向 Codex、Claude Code 与 Antigravity 开放调用。",
    tcaNotes
  );

  const tcaCheckpoints = [
    { title: "v1.0 画像与事实卡片：文档解析导入与选题草稿生成", desc: "本地项目文档解析导入，提取代码事实与工程逻辑，创作者画像建模，生成事实卡片、选题与草稿原型。", due: "2026-09-20", sort: 1 },
    { title: "v2.0 ~ v2.3 采编与审稿：热点采集与专业审稿流水线", desc: "RSS/Firecrawl CLI 本地热点采集雷达，双阶段编委会审稿（一审事实核对、二审文笔调优、主编裁决提案）。", due: "2026-09-30", sort: 2 },
    { title: "v3.0 Agent-Native 转型：去传统前端，以 Agent 对话与工具为核心", desc: "彻底摒弃传统复杂前端页面依赖，转型为 100% Agent-Native 架构，建立确定性本地 SQLite 记忆。", due: "2026-10-10", sort: 3 },
    { title: "v4.0 ~ v4.2 分发与复盘：双平台自适应分发、指标复盘与全量 MCP", desc: "知乎与微信公众号双平台自适应排版分发，阅读量/互动数据量化登记与复盘分析，全套 MCP 原生工具集成。", due: "2026-10-18", sort: 4 }
  ];

  for (const cp of tcaCheckpoints) {
    db.prepare(`
      INSERT INTO project_task_plans (
        id, project_id, title, description, due_date, status,
        completed_at, todo_task_id, sort_order, row_version, created_at, updated_at
      ) VALUES (
        ?, ?, ?, ?, ?, 'done',
        ?, NULL, ?, 1, ?, ?
      )
    `).run(
      randomUUID(),
      tcaId,
      cp.title,
      cp.desc,
      cp.due,
      `${cp.due} 18:00:00`,
      cp.sort,
      `${cp.due}T09:00:00.000Z`,
      `${cp.due}T18:00:00.000Z`
    );
  }

  const tcaLogs = [
    { at: "2026-09-10T09:00:00.000Z", kind: "milestone", content: "🚀 Tech Creator Agent 正式立项启动" },
    { at: "2026-09-20T18:00:00.000Z", kind: "task_completed", content: "✓ 完成 v1.0 验收：项目文档解析导入与画像事实卡片打通" },
    { at: "2026-09-30T18:00:00.000Z", kind: "task_completed", content: "✓ 完成 v2.0~v2.3 验收：热点采集雷达与双阶段审稿流水线落地" },
    { at: "2026-10-10T18:00:00.000Z", kind: "task_completed", content: "✓ 完成 v3.0 验收：Agent-Native 架构彻底转型完成" },
    { at: "2026-10-18T22:00:00.000Z", kind: "task_completed", content: "✓ 完成 v4.2 验收：双平台分发、指标复盘与全量 MCP 原生工具集成圆满收官" }
  ];

  for (const log of tcaLogs) {
    db.prepare(`
      INSERT INTO project_activity_logs (
        id, project_id, kind, content, important, created_at
      ) VALUES (
        ?, ?, ?, ?, 1, ?
      )
    `).run(randomUUID(), tcaId, log.kind, log.content, log.at);
  }
})();

db.close();
console.log("Both Personal AI OS and Tech Creator Agent recorded successfully!");
