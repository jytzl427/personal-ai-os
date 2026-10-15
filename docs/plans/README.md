# 第一版界面重构计划（历史）

规格来源：[UI-RESTRUCTURE-DESIGN.md](../UI-RESTRUCTURE-DESIGN.md)  
现状：本目录对应的第一版界面重构主体已经实施，保留作历史设计与验收依据，不再作为当前待办清单。

当前事实请看 [`../交付手册.md`](../交付手册.md) 和 [`../CURRENT-STATE.md`](../CURRENT-STATE.md)。[`../REMAINING-PLAN.md`](../REMAINING-PLAN.md) 只描述收尾项。后续实现以用户最近明确要求、当前代码为准；本目录不应再次触发第一版页面重构，也不能当作现行待办。

## 阅读顺序

| 文件 | 内容 |
| --- | --- |
| [01-architecture.md](./01-architecture.md) | 信息架构、路由、页面草图、今日页职责 |
| [02-data-and-archive.md](./02-data-and-archive.md) | 数据模型、归档状态机、迁移 |
| [03-pages-api-components.md](./03-pages-api-components.md) | 各页交互、标签颜色、API、前端拆分 |
| [04-ai-mcp-stats.md](./04-ai-mcp-stats.md) | 管家对话/图片、skill+MCP、统计预留 |
| [05-implementation.md](./05-implementation.md) | 分步实施、文件清单、测试命令 |
| [06-acceptance.md](./06-acceptance.md) | 验收标准、风险、已锁定决策 |

## 已实施的第一版范围

已做：左侧固定导航、独立页面、任务/想法可编辑表、项目画廊+详情、财务快捷按钮、健康日记录、每日/阶段复盘、管家历史与图片、归档查看恢复、设置里的 API 配置。

不做：删除/清理归档、统计计算、投资持仓、习惯饮食心情、多用户、云同步、绑定某一家模型、AI 改代码或改表。

## 实施阶段（与规格第 13 节一致）

1. 壳：固定导航 + hash 路由 + 页面组件拆分  
2. 任务表 + 自动归档  
3. 想法表 + 自动归档  
4. 项目画廊与详情  
5. 财务快捷按钮与分类  
6. 健康今日+时间线  
7. 每日复盘、阶段复盘  
8. 管家历史、归档、复制、图片  
9. 归档中心与 API 设置  
10. 统计入口预留  

每阶段必须能 `pnpm typecheck` 且 `pnpm test` 通过后再进入下一阶段。

## 仓库里继续有效的文档

- `docs/PLAN.md`：原架构（单写者、财务四域、确认票、端口 4738）  
- `docs/DECISIONS.md`：D1–D12  
- `docs/MCP.md` / `docs/SECURITY.md` / `docs/TEST.md` / `docs/ROADMAP.md`  

本计划不推翻这些决策，只在其上补齐界面第一版。
