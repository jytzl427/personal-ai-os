import Database from "file:///C:/Users/jytzl/.paios/desktop-runtime/resources/paios-server/node_modules/better-sqlite3/lib/index.js";
import { randomUUID } from "node:crypto";

const dbPath = "C:/Users/jytzl/.paios/paios.db";
const db = new Database(dbPath);

const projectId = randomUUID();
const now = new Date().toISOString();

console.log("Inserting project Atlas Invest:", projectId);

db.transaction(() => {
  // 1. Project
  db.prepare(`
    INSERT INTO projects (
      id, name, description, status, priority, progress_manual,
      benefit_enabled, benefit_cents, category, started_at, target_date,
      end_date, target_result, benefit_kind, archive_requested, row_version,
      created_at, updated_at
    ) VALUES (
      ?, ?, ?, 'done', 'P2', 100,
      0, NULL, 'advancement', '2026-08-15', '2026-10-20',
      '2026-10-20', ?, 'none', 0, 1,
      '2026-08-15T09:00:00.000Z', '2026-10-20T22:00:00.000Z'
    )
  `).run(
    projectId,
    "Atlas Invest — Agent-Native AI Investment OS",
    "本地落地的 Agent-Native AI Investment OS：以马科维茨现代投资组合理论与贝叶斯优化为底座，先建五大投资大脑内核（Memory / Evidence / Context / Policy / Decision），再挂专科 Agent 与周期工作流，形成「情报向量化 ➔ 多因子安全边际定价 ➔ Black-Litterman 贝叶斯均衡配置 ➔ 动态价值平均火控执行 ➔ 归因复盘」的全链路量化投资闭环。",
    "落地一套具备“日常低心力防御（红利低波高股息）”与“周期极端错杀暴击（宽基指数非对称赔率猎杀）”双轨驱动的 Agent-Native AI 投资决策与量化执行操作系统，建立确定性的现代投资学数学与统计定价底座，杜绝模型主观幻觉。"
  );

  // 2. Workspace
  const notesMd = `### 🌟 Atlas Invest OS 核心演进脉络与三大版本蓝图

一套完全运行在本地、以数学和数据为刚性锚点的自适应周期量化操作系统（Adaptive Cyclical Quantitative OS）。

| 版本里程碑 | 攻坚周期 | 核心架构与工程理论交付 | 验收状态 |
| :--- | :--- | :--- | :--- |
| **V1.0 架构奠基** | 2026.08.15 ─ 2026.08.25 | **五大投资大脑底座与鉴权体系**<br>• 搭建 5 大投资大脑底座（Memory, Evidence, Context, Policy, Decision）<br>• 7 大专业能力模块与 LEVEL 0-3 权限系统<br>• 建立确定性数字落盘、无状态单次推演与纸面账本 | **✓ 验收通过** |
| **V2.0 周期工作流** | 2026.08.26 ─ 2026.09.15 | **智能定投与资金防爆墙**<br>• DCA 智能定投每日决策火控与纸面组合闭环<br>• 现金软目标（cash_target）与已部署净额（net_deployed）核算机制<br>• 交易日历感知与战术预算自适应隔离 | **✓ 验收通过** |
| **V3.0 自适应量化 OS** | 2026.09.16 ─ 2026.10.20 | **现代投资学理论与数学内核落地**<br>• 双轨驱动范式：70%+现金流动性防守轨 + 极端恐慌错杀肥球收割轨<br>• Black-Litterman 贝叶斯均衡配置器（带约束最优权重求解）<br>• 多因子安全边际定价引擎（DDM 股息利差溢价、ERP 股权风险溢价、TIPS 敏感度）<br>• 自适应价值平均与阶梯止盈火控；全能力 MCP 原生工具集成 | **✓ 验收通过** |
`;

  db.prepare(`
    INSERT INTO project_workspaces (
      project_id, introduction, goals, current_situation, notes, updated_at
    ) VALUES (
      ?, ?, ?, ?, ?, '2026-10-20T22:00:00.000Z'
    )
  `).run(
    projectId,
    "本地落地的 Agent-Native AI Investment OS，以数学和数据为刚性锚点，双轨驱动运行。",
    "双轨驱动：低心力日常造血防御（70%+现金流动性 + 红利低波免手续费再投资）与周期极端错杀暴击（宽基指数非对称赔率猎杀）。",
    "已圆满完成 V1.0、V2.0、V3.0 三大版本研发与实盘回放检验，全面具备 Black-Litterman 均衡配置、多因子定价与全量 MCP 接口能力。",
    notesMd
  );

  // 3. Task plans (Checkpoints)
  const checkpoints = [
    {
      title: "V1.0 架构奠基：五大投资大脑底座与 LEVEL 0-3 权限系统",
      desc: "搭建五大投资大脑内核底座（Memory, Evidence, Context, Policy, Decision），落地 7 大专业能力模块与 LEVEL 0-3 权限系统，建立本地不可逆纸面账本与证据链追踪。",
      due: "2026-08-25",
      sort: 1
    },
    {
      title: "V2.0 周期工作流：DCA 每日决策火控与智能定投闭环",
      desc: "落地周期工作流与智能定投决策系统（DCA 每日决策火控、纸面组合闭环、内核咬合），引入现金软目标（cash_target）与已部署净额（net_deployed）核算机制，筑牢纪律性防爆墙。",
      due: "2026-09-15",
      sort: 2
    },
    {
      title: "V3.0 自适应周期量化操作系统：Black-Litterman 与多因子定价",
      desc: "完成范式重构与双轨驱动定位；落地 Black-Litterman 贝叶斯均衡配置器、多因子安全边际定价引擎（DDM+股息利差溢价+ERP股权风险溢价）、自适应价值平均与阶梯止盈火控；全能力接入 MCP 协议与独立纸面账本。",
      due: "2026-10-20",
      sort: 3
    }
  ];

  for (const cp of checkpoints) {
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
      projectId,
      cp.title,
      cp.desc,
      cp.due,
      `${cp.due} 18:00:00`,
      cp.sort,
      `${cp.due}T09:00:00.000Z`,
      `${cp.due}T18:00:00.000Z`
    );
  }

  // 4. Activities
  const logs = [
    { at: "2026-08-15T09:00:00.000Z", kind: "milestone", content: "🚀 项目正式立项启动，确立 Agent-Native AI Investment OS 架构目标" },
    { at: "2026-08-25T18:00:00.000Z", kind: "task_completed", content: "✓ 完成 V1.0 验收：五大投资大脑底座与 LEVEL 0-3 权限系统全部通过" },
    { at: "2026-09-15T18:00:00.000Z", kind: "task_completed", content: "✓ 完成 V2.0 验收：周期工作流与智能定投闭环测试通过" },
    { at: "2026-10-20T22:00:00.000Z", kind: "task_completed", content: "✓ 完成 V3.0 验收：自适应周期量化操作系统、数学定价引擎与 MCP 原生工具集成圆满收官" }
  ];

  for (const log of logs) {
    db.prepare(`
      INSERT INTO project_activity_logs (
        id, project_id, kind, content, important, created_at
      ) VALUES (
        ?, ?, ?, ?, 1, ?
      )
    `).run(
      randomUUID(),
      projectId,
      log.kind,
      log.content,
      log.at
    );
  }
})();

db.close();
console.log("Atlas Invest inserted successfully!");
