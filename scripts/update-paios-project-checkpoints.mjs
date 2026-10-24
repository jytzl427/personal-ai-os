import { createRequire } from "module";
import { randomUUID } from "crypto";

const req = createRequire(import.meta.url);
const Database = req(req.resolve("better-sqlite3", { paths: ["./packages/db"] }));

const dbPath = "C:/Users/jytzl/.paios/paios.db";
const db = new Database(dbPath);
const projectId = "2e388aad-6955-4bea-808b-987eadeacca0";
const timestamp = new Date().toISOString();

console.log("Updating checkpoints and workspace for Personal AI OS in:", dbPath);

const checkpointsToAdd = [
  {
    title: "v3.0 原生图表与美学：零外部依赖 SVG 可视化、财务雷达与健康走势",
    description: "零重依赖原生 SVG 可视化（体重走势面积图、睡眠时长柱状图、分类堆叠条），财务限额雷达与冲动消费预警，待办项目关联标签。",
    due_date: "2026-10-23",
    sort_order: 5,
    completed_at: "2026-10-23 18:00:00"
  },
  {
    title: "v3.1 HUD 速览架构：高密度 Bento 计划速览与 Body Portal 挂载",
    description: "每日计划与阶段计划速览卡片重构为高密度 Bento HUD 架构，React Portal 挂载至 document.body 彻底解决视口滚动挤压与遮挡，项目链接后移备忘列。",
    due_date: "2026-10-23",
    sort_order: 6,
    completed_at: "2026-10-23 22:00:00"
  },
  {
    title: "v3.2 子任务与双向联动：无限子任务、双向精准同步与阶段攻坚目标",
    description: "待办无限子任务与验收节点双向精准联动，每日计划速览交互直接打勾与即时编辑，阶段计划设置阶段攻坚目标定额，财务健康 32px 留白对齐底盘，复盘双栏阅读编辑画布。",
    due_date: "2026-10-24",
    sort_order: 7,
    completed_at: "2026-10-24 10:00:00"
  },
  {
    title: "v3.3 待办单排与原生环形：单排舒朗布局、子任务按需创建与 Donut 图",
    description: "待办顶栏单排舒朗收拢，备注列纯粹化，展开箭头淡化，父子任务明确层级区分，展开不默认创建子任务，父任务状态由子任务联动，彻底消除孤儿节点，财务纯原生 SVG 甜甜圈环形图。",
    due_date: "2026-10-24",
    sort_order: 8,
    completed_at: "2026-10-24 13:00:00"
  },
  {
    title: "v3.4 树形精细化与双核 Bento：父任务默认收起、矢量 Chevron 与 Bento 大盘",
    description: "待办父任务默认折叠收拢，矢量 Chevron 弹簧展开与精确 SVG 树形分支指引线，父任务状态胶囊一键批量联动，财务双核指标 Bento 大盘重构，全套 45 项单元测试 100% 通过。",
    due_date: "2026-10-24",
    sort_order: 9,
    completed_at: "2026-10-24 15:00:00"
  }
];

const newNotes = `### 🌟 Personal AI OS 核心演进脉络与全版本蓝图（v1.0 ~ v3.4）

一套本地离线优先、全周期规范咬合的个人 AI 操作系统（Personal AI OS）。

| 版本里程碑 | 攻坚周期 | 核心架构与业务系统交付 | 验收状态 |
| :--- | :--- | :--- | :--- |
| **v1.0 规范底盘** | 2026.09.01 ─ 2026.09.15 | **三大规范体系与业务底盘**<br>• 制定三大计划与复盘原则（阶段计划、每日计划、每日复盘与阶段复盘铁律）<br>• 落地待办任务、财务双轨记账、健康称重/睡眠数据底座与 SQLite WAL 存储 | **✓ 验收通过** |
| **v1.1 界面与动效** | 2026.09.16 ─ 2026.09.30 | **极简高质感微动效与交互打磨**<br>• 交互精细化重构：数据可视化看板、状态条纹感知与移动端自适应布局<br>• 优化快速记账预设、分类树与注意力横幅动态提醒机制 | **✓ 验收通过** |
| **v2.0 独立桌面端** | 2026.10.01 ─ 2026.10.15 | **Tauri 2.0 桌面端与双向 MCP 协议**<br>• Windows 桌面原生封装（Tauri 2.0），内置嵌入式 Node.js 独立运行环境<br>• 原生双向 MCP 协议（Stdio / Direct HTTP），打通与 Claude、Codex、Antigravity 代理协同 | **✓ 验收通过** |
| **v2.1 推进闭环升级** | 2026.10.16 ─ 2026.10.21 | **甘特时间轴、行动卡槽与智能联动**<br>• 推进项目甘特时间轴与方案 B 行动卡槽升级，阶段卡片流自适应排版<br>• 落地属性实时自动保存、日历一键清除、验收节点自由调序（▲/▼）<br>• 历史完结项目一键唤醒机制、2 天内节点自动同步待办任务、可折叠左侧导航栏 | **✓ 验收通过** |
| **v3.0 原生图表与美学** | 2026.10.22 ─ 2026.10.23 | **零重依赖原生 SVG 数据可视化与全站美学**<br>• 体重走势面积曲线、睡眠时长柱状图、分类堆叠条纯原生 SVG 渲染<br>• 财务餐饮限额雷达与冲动消费预警、健康双轨走势、待办项目关联标签 | **✓ 验收通过** |
| **v3.1 HUD 速览架构** | 2026.10.23 | **高密度 Bento HUD 架构与 Portal 挂载**<br>• 每日计划与阶段计划速览卡片重构为 Bento HUD 架构，视口防挤压<br>• React Portal 挂载至 document.body，项目链接胶囊后移备忘列 | **✓ 验收通过** |
| **v3.2 子任务与双向联动** | 2026.10.24 | **无限子任务、双向属性同步与阶段目标定额**<br>• 待办支持递归子任务，修改标题/日期反向精准更新项目验收节点<br>• 每日计划速览交互式直接打勾与即时编辑保存，阶段计划设置阶段攻坚目标<br>• 财务健康 32px 留白对齐底盘表格，复盘双栏阅读编辑画布 | **✓ 验收通过** |
| **v3.3 待办单排与原生环形** | 2026.10.24 | **待办单排排版回归、子任务按需创建与原生环形图**<br>• 待办顶栏单排舒朗收拢，备注列纯粹化，展开箭头淡化，父子层级清晰区分<br>• 展开不默认创建子任务，父任务状态由子任务联动驱动，消除孤儿节点<br>• 财务去形式化限额，纯原生 SVG 甜甜圈环形图（Donut Chart） | **✓ 验收通过** |
| **v3.4 树形精细化与 Bento 重构** | 2026.10.24 | **父任务默认收起、矢量 Chevron 弹簧展开与双核 Bento**<br>• 父任务默认折叠收起，矢量 Chevron 弹簧展开与精确 SVG 树形分支指引线<br>• 父任务状态胶囊一键批量联动，财务双核指标 Bento 大盘重构<br>• 45 项单元测试 100% 通过，自动化发布流水线与独立文档 | **✓ 验收通过** |
`;

const newSituation = "已圆满完成从 v1.0、v2.0 到 v3.4 全系列大版本重构与深层质感演进，待办子任务与双向联动体系、财务双核 Bento 与原生 SVG 甜甜圈图表、Bento HUD 计划与复盘闭环全部高质交付，系统高度稳定成熟。";

const newDesc = "本地单机部署、隐私优先的个人 AI 操作系统。整合本地 SQLite 数据库、Hono RESTful API、Tauri 2.0 桌面原生宿主与双向 MCP 协议服务端。历经规范打磨、UI 动效重构、原生桌面端封装、待办无限子任务与双向精准联动、财务双核 Bento 与原生 SVG 甜甜圈图表等全链路全版本（v1.0 ~ v3.4）深度演进。";

const newTargetResult = "打造一套本地离线优先、全周期规范咬合的个人 AI 操作系统（三大核心底盘：阶段与每日计划/复盘系统、双向 Agent-Native 协作底座、Tauri 桌面原生客户端），实现无限子任务树形联动、纯原生 SVG 数据可视化、双核 Bento 财务大盘与全自动化资产/健康/任务数字化管理。";

const activitiesToAdd = [
  "✓ 完成 v3.4 验收：父任务默认折叠收起、矢量 Chevron 弹簧展开、树形连接线与双核 Bento 质感重构圆满收官",
  "✓ 完成 v3.3 验收：待办单排排版、子任务按需创建、状态联动与财务原生甜甜圈环形图",
  "✓ 完成 v3.2 验收：待办无限子任务与验收节点双向精准联动、阶段目标定额与复盘双栏画布",
  "✓ 完成 v3.1 验收：高密度 Bento HUD 计划速览卡片与 Body Portal 防遮挡重构",
  "✓ 完成 v3.0 验收：零重依赖原生 SVG 数据可视化与全站美学质感升级"
];

const update = db.transaction(() => {
  // 1. Update project row
  db.prepare(`
    UPDATE projects
    SET description = ?, target_result = ?, end_date = '2026-10-24', target_date = '2026-10-24', score = 95, progress_manual = 100, updated_at = ?, row_version = row_version + 1
    WHERE id = ?
  `).run(newDesc, newTargetResult, timestamp, projectId);

  // 2. Update workspace notes & current_situation
  db.prepare(`
    UPDATE project_workspaces
    SET notes = ?, current_situation = ?, updated_at = ?
    WHERE project_id = ?
  `).run(newNotes, newSituation, timestamp, projectId);

  // 3. Insert checkpoints if not already existing
  const insertTask = db.prepare(`
    INSERT INTO project_task_plans (id, project_id, title, description, due_date, status, todo_task_id, completed_at, sort_order, created_at, updated_at, row_version)
    VALUES (?, ?, ?, ?, ?, 'done', NULL, ?, ?, ?, ?, 1)
  `);

  for (const item of checkpointsToAdd) {
    const existing = db.prepare(`
      SELECT id FROM project_task_plans WHERE project_id = ? AND title = ? AND archived_at IS NULL
    `).get(projectId, item.title);

    if (!existing) {
      const id = randomUUID();
      insertTask.run(id, projectId, item.title, item.description, item.due_date, item.completed_at, item.sort_order, timestamp, timestamp);
      console.log("Added checkpoint:", item.title);
    } else {
      console.log("Checkpoint already exists:", item.title);
    }
  }

  // 4. Insert activities if not already existing
  const insertActivity = db.prepare(`
    INSERT INTO project_activity_logs (id, project_id, kind, content, important, created_at)
    VALUES (?, ?, 'task_completed', ?, 1, ?)
  `);

  for (const act of activitiesToAdd) {
    const existing = db.prepare(`
      SELECT id FROM project_activity_logs WHERE project_id = ? AND content = ?
    `).get(projectId, act);

    if (!existing) {
      insertActivity.run(randomUUID(), projectId, act, timestamp);
      console.log("Added activity log:", act);
    }
  }
});

update();
console.log("Transaction committed successfully!");

// Verification
const finalCheckpoints = db.prepare(`
  SELECT id, title, due_date, status, sort_order
  FROM project_task_plans
  WHERE project_id = ? AND archived_at IS NULL
  ORDER BY sort_order ASC, due_date ASC
`).all(projectId);

console.log("\nFinal Checkpoints list (" + finalCheckpoints.length + " total):");
finalCheckpoints.forEach(c => {
  console.log(` ${c.sort_order}. [${c.status}] ${c.due_date}: ${c.title}`);
});
