# AI 管家计划-复盘-项目推进闭环

> 基线：2026-09-06。不新增业务表。不引入操作系统级后台调度。

**目标：** 让管家形成「读取真实数据 → 阶段/每日计划草案 → 用户修改确认 → 项目范围内推进 → 按执行情况调整 → 复盘进入数据库 → 影响下一阶段」的闭环。

**做法：** 在现有 SQLite、MCP、管家工具循环上增加只读上下文工具和草稿写入工具；任务日期一律按 `due_date`（界面「任务日期」= 执行日期）过滤；周期实例仍由服务端生成。

---

## 实施前缺口（已落地，勿按此表重做）

下表是 2026-09-06 动手前的缺口。当前源码已补：`planning.ts`、`attention_get`、`planning_context_get`、`plans_update`、`period_plans_upsert`、复盘事实三分、due_date 统计、阶段计划确认后门禁、管家页跨时段检查。

| 当时缺口 | 现况 |
| --- | --- |
| 阶段计划读想法、上阶段复盘、财务、健康、项目、逾期/无日期 | `planning_context_get` + `period_plans_upsert` |
| 每日计划混用 `scheduled_date` | 读取和统计只用 `due_date` |
| 无 `plans_update` | 已有，可记录调整原因 |
| 复盘只有计数 | 客观统计 / 分析 / 建议；时段检查写入当日草稿 |
| 无项目姿态 | `classifyProjectPosture`；未确认阶段计划不得推进 |
| 无启动/时段提醒 | AppShell 摘要 + 管家页按时段检查；关闭后不联系 |

## 权限与风险（已纳入实现，不另开表）

1. **无新数据库。** 计划正文仍写 `daily_plans.plan_text` / `period_plans.plan_text`；复盘客观数据写 `reviews.content_json`。
2. **无系统后台守护进程。** 启动时只计算注意力摘要；界面打开期间用前端定时器换时段；软件关闭后不承诺主动联系。
3. **管家页面打开期间每时段最多自动发起一次检查。** 页面持续打开跨入下一时段时会再检查。可能消耗 LLM、并把检查结果写入当日复盘草稿。不创建任务、不删除、不确认。无 API Key 时只显示摘要。软件关闭后不能主动联系。
4. **Agent 禁止：** 确认计划、最终确认复盘、暂停/放弃项目、归档/删除/恢复、改设置。暂停项目不新开确认票，直接拒绝并请用户在界面操作。
5. **执行日期：** 读取与计划/复盘统计只用 `due_date`。`scheduled_date` 保留写入兼容，不再当作执行日期。旧复盘最终确认和阶段复盘创建接口同样只按 `due_date` 计数。
6. **项目推进：** 管家/MCP 更新项目、工作区或给任务关联项目，必须先有覆盖当天的已确认阶段计划。创建空项目工作区、独立任务、财务/健康/计划草稿不受此限制。人工界面不受此限制。
7. **写入：** 新工具走现有审计、幂等键、`row_version` 冲突。周期实例仍只由服务端生成。


## 新增工具（复用现有域）

只读：`attention_get`、`planning_context_get`  
普通写入：`plans_update`、`period_plans_upsert`、`reviews_period_generate`

## 文件

- 新增：`apps/server/src/planning.ts`、`planning.test.ts`
- 修改：planner / review-drafts / butler-agent / butler-writes / tool-catalog / mcp / app / auth / capabilities / core 白名单
- 界面：AppShell 注意力条、Butler 打开时检查、复盘详情展示客观数据（不重做页面）
- 文档：Skill、交付手册/CURRENT-STATE 同步口径
