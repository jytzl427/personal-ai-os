import http from "node:http";

async function req(method, path, body) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const request = http.request(
      {
        hostname: "127.0.0.1",
        port: 4738,
        path: "/api/v1" + path,
        method,
        headers: {
          "Content-Type": "application/json",
          ...(data ? { "Content-Length": Buffer.byteLength(data) } : {}),
        },
      },
      (res) => {
        let buf = "";
        res.on("data", (c) => (buf += c));
        res.on("end", () => {
          try {
            resolve(JSON.parse(buf));
          } catch {
            resolve(buf);
          }
        });
      }
    );
    request.on("error", reject);
    if (data) request.write(data);
    request.end();
  });
}

async function main() {
  const id = "06e05bc8-6406-437a-9ceb-1f96602796d1";
  const projRes = await req("GET", `/projects/${id}`);
  const current = projRes.project;
  console.log("Current row_version:", current.row_version);

  // 1. Update project base attributes
  await req("PATCH", `/projects/${id}`, {
    name: "knowledge-base-manager",
    category: "advancement",
    status: "done",
    started_at: "2026-04-07",
    end_date: "2026-06-02",
    target_result: "从零构建并经过 13 轮大版本深度重构，打造出集本地智能检索、指数衰减加权复习算法、碎片化智能归并与内存索引缓存于一体的 Obsidian 知识库管理系统与 Agent Skill",
    description: "初涉 AI 编写的首个推进项目。历经两个月从 v1.0 连续迭代至 v13.1.0：跨越单文件 4200 行解耦拆解、126 个单元测试体系、中文分词本地检索、指数衰减遗忘算法治理、智能语义归并治理碎片化以及 Windows CRLF 跨平台企业级加固，最终沉淀为高稳定性、零外部依赖的个人知识库工具底座。",
    benefit_enabled: false,
    archive_requested: false,
    row_version: current.row_version,
  });

  // 2. Update workspace notes
  const notesMd = `### 🌟 项目全周期演化脉络与核心版本要点（v1.0 ~ v13.1.0）

本项目为接触 AI 后的首个推进落地项目，历时约两个月（2026.04.07 ─ 2026.06.02），经历多轮推翻式重构与算法打磨：

| 演化阶段 | 版本跨度 | 核心攻坚要点与技术沉淀 |
| :--- | :--- | :--- |
| **阶段一：雏形初建** | v1.0 ─ v3.0 *(04.07~04.13)* | **笔记处理与 Obsidian 集成**<br>• 支持文字/图片提取总结与智能分类<br>• 引入 Mermaid 思维导图与标签系统<br>• 首次基于艾宾浩斯遗忘曲线引入笔记复习机制 |
| **阶段二：检索与规范** | v4.0 ─ v6.1 *(04.15~05.02)* | **本地化语义检索与命令体系**<br>• 零 API 调用：中文分词 + 停用词过滤 + 同义词扩展<br>• 首次确立加权随机复习法；制定 6 段式标准笔记模板与自动化验证<br>• 扁平化 CLI 路由与参数 Schema 严格校验 |
| **阶段三：算法破局** | v7.0 ─ v8.0 *(05.07~05.20)* | **聚焦精简与复习算法数学化**<br>• 精简为 5 大核心命令，模板由 6 段式精简为 4 段式<br>• 复习算法升级为指数衰减公式：权重 = 100 × (0.7 ^ 复习次数)<br>• 引入成熟笔记每日限额、动态未复习阈值与路径遍历安全沙箱防护 |
| **阶段四：架构大手术** | v9.0 ─ v10.8 *(05.23~05.24)* | **4200 行单文件解耦与工程体系**<br>• 消除 7 个低价值冗余模块，4212 行代码拆解为 8 大功能模块 + 3 独立配置<br>• 建立 126 项单元测试（覆盖率 77%）；引入结构化 Logger 与 dry-run 机制<br>• 消除多次磁盘遍历，单次 Vault 扫描合并统计 |
| **阶段五：复习算法加固** | v11.0 ─ v11.6.7 *(05.24~05.25)* | **算法防劣化与防 AI 幻觉干预**<br>• 全面迁移至 Store 抽象层，杜绝直接 fs.* 旁路调用<br>• 算法引入动态遗忘曲线并设上限（封顶 30 天，新笔记享基础权重）<br>• 复习输出改用标准化 Markdown 表格，**明确规范禁止 AI 擅自加戏或代替用户总结** |
| **阶段六：终极收官** | v12.0 ─ v13.1.0 *(06.01~06.02)* | **智能语义归并与跨平台加固**<br>• 智能归并规则：创建前语义扫描同类笔记，自动追加合并（治理笔记碎片化）<br>• 自适应模板（小/中/大主题自适应层级）<br>• 全面换用 js-yaml 与内存索引缓存层（500 篇笔记由 2500 次 I/O 降至 1 次）<br>• 解决 Windows CRLF 换行符系统性缺陷，圆满收官 |
`;

  await req("PATCH", `/projects/${id}/workspace`, { notes: notesMd });

  // 3. Clear old tasks and recreate 6 milestone checkpoints
  const taskList = projRes.project_tasks || [];
  for (const t of taskList) {
    await req("DELETE", `/project-task-plans/${t.id}`);
  }

  const milestones = [
    { title: "v1.0 ~ v3.0: 知识提取、Obsidian 集成与基础复习体系", due_date: "2026-04-13" },
    { title: "v4.0 ~ v6.1: 本地中文分词检索、加权随机复习与标准规范", due_date: "2026-05-02" },
    { title: "v7.0 ~ v8.0: 核心精简、指数衰减复习算法与安全沙箱", due_date: "2026-05-20" },
    { title: "v9.0 ~ v10.8: 4200行单文件架构解耦与126项单元测试体系", due_date: "2026-05-24" },
    { title: "v11.0 ~ v11.6.7: 复习算法防退化加固与 Markdown 渲染标准化", due_date: "2026-05-25" },
    { title: "v12.0 ~ v13.1.0: 智能语义归并、索引缓存与跨平台 CRLF 企业级加固", due_date: "2026-06-02" },
  ];

  for (const m of milestones) {
    await req("POST", `/projects/${id}/task-plans`, {
      title: m.title,
      due_date: m.due_date,
      status: "done",
      add_to_todo: false,
    });
    console.log("Added checkpoint:", m.title);
  }

  // 4. Add activity log
  await req("POST", `/projects/${id}/activities`, {
    content: "📖 补充完整更新日志历史（v1.0 ─ v13.1.0，2026.04.07 ─ 2026.06.02），提炼并沉淀六大核心演进阶段与验收节点",
    kind: "milestone",
    important: true,
  });

  console.log("knowledge-base-manager updated successfully!");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
