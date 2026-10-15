# Personal AI OS 当前能力清单

基线：2026-09-09。当前执行主计划是 [`REMAINING-PLAN.md`](./REMAINING-PLAN.md)，本文件只记录实现事实，不替代计划。钥匙和管家主体已落地；剩余项是统一业务网关抽取、真实外部 Agent 长流程、前端 E2E 和安装包。

R0–R6 的主要代码能力已完成，目前仍有统一业务网关、真实外部 Agent 全流程、前端 E2E 和 NSIS/MSI 安装包等收尾项。

## 已落地

| 范围 | 当前能力 | 证据 |
| --- | --- | --- |
| 本地数据库 | SQLite、迁移、WAL、单写者锁、任务/周期任务、项目、财务、健康、复盘、归档、备份恢复；启动时按本地时区检查周日锚点，原子校验周备份并只保留最近 3 份 | `packages/db/src/index.ts` |
| 任务可靠性 | 独立周期模板；启动/MCP补齐；模板版本化未来生效；仅修改内容时保留原周期锚点；暂停跳过；唯一发生台账；GUI/MCP租约锁；删除实例不重建；删除模板不会被旧自动保存复活；跨月、闰日、重复启动、大间隔备份有回归测试 | `apps/server/src/recurrence.ts`、`apps/server/src/recurrence-service.ts`、`apps/server/src/recurrence.test.ts` |
| Agent 钥匙 | MCP stdio、Bearer token 哈希校验、过期/撤销、按域读写 scope、设置页创建/轮换/撤销、连接测试和最近调用摘要；高风险接口要求内存级 UI 会话 | `apps/server/src/auth.ts`、`apps/server/src/app.ts`、`apps/web/src/pages/SettingsPage.tsx` |
| MCP | 生产 EXE 直接 MCP（无需 UI/HTTP）；任务、项目、想法、财务、健康、复盘、计划工具；独立周期模板创建/更新/检查/历史读取；能力说明、today/schema/project/finance/workflow 资源；命名批量调用；普通写入幂等键；真实 stdio 权限、资源和工具契约验收 | `apps/server/src/mcp.ts`、`apps/server/src/mcp.integration.test.ts`、`apps/desktop/src-tauri/src/lib.rs` |
| AI 管家 | 真实工具循环；阶段/每日计划上下文；按 due_date 读取任务和复盘统计；项目姿态判断；复盘含客观统计/分析/建议；管家页跨时段补查；明确下令后的普通写入；未确认阶段计划时服务端拒绝项目推进；不能暂停/放弃项目或确认计划 | `apps/server/src/planning.ts`、`apps/server/src/butler-agent.ts`、`apps/server/src/butler-writes.ts`、`apps/server/src/planner.ts`、`apps/server/src/review-drafts.ts` |
| Web | 独立页面、固定导航、数据库编辑、财务分类、健康运动、复盘详情、归档、API/Agent 设置和周备份状态；生产构建通过 | `apps/web/src/pages/`、`apps/web/dist/` |
| 桌面交付 | Tauri 单文件 EXE 内嵌 Node/SQLite 运行时；普通模式单实例；`--mcp` 模式可与图形界面并行启动；首次运行自动释放并复用本地运行缓存；残留锁按 PID 自动清理；启动时优先使用 EXE 内嵌资源，避免旁边旧 resources 覆盖；本机服务启动诊断日志 | `apps/desktop/src-tauri/src/lib.rs`、`apps/desktop/src-tauri/src/embedded_resources.rs`、`apps/server/src/lock.ts` |

## 部分完成

- REST、MCP、页内管家已经共享同一数据库、schema 校验、归档规则、计划生成和周期任务服务；业务命令尚未完全抽成一个独立的工具网关，当前直接 MCP 通过同一 Hono 业务应用执行，避免第二套 SQL 规则。
- Agent 审计已记录 token/Agent/工具身份、统一变更编号、变更前后快照；请求参数和快照中的 API Key、Token、密码等敏感字段会脱敏并限制长度。普通写入支持幂等键，同一键重试会复用成功响应。
- 普通写入已覆盖计划草稿、复盘草稿、项目范围内推进和财务/健康等第一批能力；取消请求、部分成功轨迹保留、幂等、失败重试、审计快照和工具契约已有回归测试；统一业务网关进一步抽取和真实第三方 Agent 的长流程仍待补。
- 单文件 EXE 已在“只保留 EXE、不带 resources 文件夹”的临时目录中启动，并通过 `/api/v1/system/status` 启动检查；当前已验证 GUI 服务启动、MCP 直连和多域读写，完整 Windows 浏览器端到端交互仍待补。
- Tauri 的 NSIS/MSI 自动封装仍受本机跨磁盘临时目录错误影响；本轮已清理旧残留服务，并将修复后的单文件 EXE 同步到默认路径 `release/Personal-AI-OS.exe`，已完成 GUI、`--mcp` 和 `--restore-latest` 验收。
- 周备份失败不会阻止服务启动；失败结果会进入启动日志和系统状态接口，并在下一次启动重试。手动、恢复安全和周备份分别最多保留 3 份，非法保留数量不能扩大上限；备份列表会显示完整性校验结果。直连 MCP 会登记本地占用标记；恢复前若检测到 MCP 仍在运行会明确拒绝，要求先关闭 MCP 再重启图形界面，避免恢复期间并发读写；EXE 的 `--restore-latest` 可在主库损坏、服务无法启动时执行经过校验的本地恢复。周期模板写入后的同步遇到瞬时锁忙、部分失败或失败时会重试，并在锁租约到期后再次尝试，程序下次启动还会再次检查。

## 明确不在当前范围

统计图表、财务/健康长期数据精简、新业务属性、第三方 Agent 自动安装/编排、云同步、移动端和整体视觉重构都需要另行授权。

## 本轮交付构建

- 文件：`release/Personal-AI-OS.exe`
- 大小：97,458,688 字节；文件时间：2026-09-09 00:51:23；SHA-256：`79A5B43DBF5CF3983F8C4B8CA9B1FF106B41B048016797BCD605C117E3799D52`
- 指纹已按磁盘文件更新。2026-09-05 的 GUI/`--mcp` 抽查针对当时那份 EXE；本次指纹变化后，若要对外宣称当前 EXE 已含 9 月 6 日后的管家闭环，需再抽查一次启动和 `--mcp`。
- 源码侧：服务端测试 39/39（先 `pnpm --filter @paios/server build` 再 `test`）。
- 财务口径：普通支出和普通收入不关联账户、不创建账户流水、不改变账户余额；账户只由独立账户流水管理存入和取出。
- 今日读取和复盘统计：只按 `due_date`。只有 `scheduled_date` 的任务不进入今日任务，也不进入复盘快照。
- 单 EXE 回退构建必须使用 `cargo build --release --features custom-protocol`；缺少该特性会让窗口错误连接开发地址 `127.0.0.1:5173`。
- 数据目录：手动运行 `node ... serve` 与单文件 EXE 默认共用 `%USERPROFILE%\\.paios\\`；开发库必须显式设置 `PAIOS_DATA_DIR=.data`。
