# Personal AI OS 前端美学与交互全面升级可执行工程规范（v3.0 Executable Spec）

> **给执行 AI 的最高指令（System Directive）**：
> 你是一名顶级的全栈与前端审美工程师。请严格按照本规范，对 `D:\code\mature project\Personal AI OS` 进行前端视觉、数据可视化与交互质感的全面升级。
> **核心铁律**：
> 1. **零破坏原则**：所有现有接口调用、自动保存（Debounce/Blur）、键盘快捷键（Enter/Escape）以及乐观更新逻辑必须 100% 保留，严禁丢失任何已有功能。
> 2. **零外部重依赖**：所有图表（环形进度、趋势面积折线图、柱状图、分类占比条）一律使用**纯原生 SVG + CSS** 实现，严禁安装 `echarts`、`recharts` 等笨重第三方库，保持极速构建与轻量体积。
> 3. **工程交付与打包铁律（绝对执行）**：代码修改并验证通过后，**必须**执行桌面端 EXE 打包与发布产物同步刷新，确保用户桌面客户端 100% 同步最新代码。

---

## 0. 项目环境与架构上下文（必读）

- **代码仓库根目录**：`D:\code\mature project\Personal AI OS`
- **前端源码目录**：`D:\code\mature project\Personal AI OS\apps\web\src`
- **后端源码目录**：`D:\code\mature project\Personal AI OS\apps\server\src`
- **全局样式文件**：`D:\code\mature project\Personal AI OS\apps\web\src\index.css`（单文件集中管理 CSS 变量与模块样式，追加新样式时请置于文件末尾并标明注释分块）
- **现有色彩与视觉 Token（`index.css` `:root`）**：
  - 主色调（松石深绿）：`--accent: #154e3f`、`--accent-hover: #0f3d31`、`--accent-soft: #ecfdf5`、`--accent-border: #a7f3d0`
  - 纸感背景与表面：`--bg: #f8faf9`、`--surface: #ffffff`、`--surface-2: #f2f5f3`、`--surface-3: #e8eee9`
  - 边框与阴影：`--line: #e3e8e4`、`--shadow-card`、`--shadow-card-hover`、`--ease-spring: cubic-bezier(0.16, 1, 0.3, 1)`
- **现有主导航结构（`apps/web/src/lib/route.ts`）**：
  - 默认首页路由为 `tasks`（任务页），侧边栏 7 大核心模块依次为：`任务`、`项目`、`财务`、`健康`、`计划与复盘`、`归档`、`设置`。

---

## Step 1：全局壳层、动态导航角标与 `Ctrl+K` 极速指挥面板

### 涉及文件
- `apps/web/src/components/AppShell.tsx`
- `apps/web/src/components/CommandPalette.tsx`（**新建组件**）
- `apps/web/src/index.css`

### 具体执行要求

#### 1.1 侧边栏实时动态角标（Live Counter Pills）与搜索触发器
1. 在 `AppShell.tsx` 中，除了轮询 `/system/attention` 外，轻量并行请求 `/tasks` 与 `/projects`（或在 `loadAttention` 时同步刷新统计），计算：
   - **待办任务数 `todoCount`**：`tasks.filter(t => t.status === "todo" && !t.archived_at).length`
   - **今日/逾期任务数 `urgentTaskCount`**：`tasks.filter(t => t.status === "todo" && t.due_date && t.due_date <= todayYmd()).length`
   - **进行中推进项目数 `activeProjectCount`**：`projects.filter(p => p.status !== "done" && p.category !== "maintenance" && p.category !== "long_term" && !p.archived_at).length`
2. 在侧边栏 `.main-nav` 之前（`!collapsed` 状态下），增加一个精致的**全局命令唤起按钮 `.sidebar-cmd-trigger`**：
   - 左侧显示放大镜/闪电图标 + `"快速跳转或操作…"`，右侧显示键盘徽章 `<kbd>Ctrl K</kbd>`；
   - 点击直接打开 `CommandPalette`。
3. 在导航项 `.nav-item` 渲染时（`!collapsed` 状态下）：
   - 若 `item.label === "任务"` 且 `todoCount > 0`：右侧渲染微胶囊 `<span className={`nav-count-pill ${urgentTaskCount > 0 ? "is-urgent" : ""}`}>{todoCount}</span>`；
   - 若 `item.label === "项目"` 且 `activeProjectCount > 0`：右侧渲染 `<span className="nav-count-pill">{activeProjectCount}</span>`。

#### 1.2 新建 `CommandPalette.tsx`（Linear / Raycast 风格毛玻璃指挥中心）
1. 全局监听键盘事件：按下 `Ctrl+K` 或 `Meta+K` 切换弹窗开关；按下 `Escape` 关闭；支持 `ArrowUp` / `ArrowDown` 切换高亮项，`Enter` 触发选中项。
2. 提供三大命令分组（支持关键字实时模糊过滤）：
   - **⚡ 快捷动作（Quick Actions）**：
     - `去任务页新建待办` $\to$ 跳转 `{ name: "tasks" }`
     - `记一笔日常支出` $\to$ 跳转 `{ name: "finance", tab: "expenses" }`
     - `记录今日体重与睡眠` $\to$ 跳转 `{ name: "health" }`
     - `查看/编辑今日计划` $\to$ 跳转 `{ name: "plans", tab: "daily-plan" }`
     - `查看/编辑阶段计划` $\to$ 跳转 `{ name: "plans", tab: "stage-plan" }`
   - **🚀 活跃项目直达（Active Projects）**：动态列出未归档项目，点击直接 `onNavigate({ name: "project", id: project.id })`。
   - **🧭 页面导航（Navigation）**：列出全部 7 个主导航入口。
3. 视觉要求：遮罩层采用 `rgba(15, 23, 42, 0.28)` + `backdrop-filter: blur(6px)`；面板主体采用 `background: rgba(255, 255, 255, 0.92)` + `backdrop-filter: blur(20px)` + `border: 1px solid rgba(255,255,255,0.8)` + `box-shadow: 0 20px 50px rgba(15, 23, 42, 0.14)`。

#### 1.3 页面切换丝滑入场动效
- 在 `index.css` 中为 `.page-view` 添加入场动画：
  ```css
  @keyframes pageEnter {
    from { opacity: 0; transform: translateY(5px); }
    to { opacity: 1; transform: translateY(0); }
  }
  .page-view {
    animation: pageEnter 0.22s var(--ease-spring) both;
  }
  ```

---

## Step 2：「任务与灵感库」Bento 指挥抬头、时间切片分组与项目胶囊联动

### 涉及文件
- `apps/web/src/pages/TasksPage.tsx`
- `apps/web/src/pages/IdeasPage.tsx`
- `apps/server/src/app.ts`（仅补充 `project_id` 字段返回，便于前端点击跳转）
- `apps/web/src/index.css`

### 具体执行要求

#### 2.1 后端 `/api/v1/tasks` 补充 `project_id` 子查询
- 在 `apps/server/src/app.ts` 的 `GET /api/v1/tasks` SQL 查询中，除已有的 `project_name` 子查询外，紧挨着补充一行返回关联的 `project_id`：
  ```sql
  (
    SELECT pt.project_id 
    FROM project_task_plans pt 
    WHERE pt.todo_task_id = tasks.id 
      AND pt.archived_at IS NULL 
    LIMIT 1
  ) AS project_id
  ```
- 前端 `TasksPage.tsx` 的 `type Task` 同步声明 `project_id?: string | null; project_name?: string | null;`。

#### 2.2 任务页顶部「今日脉冲 Bento 概览条（Task Pulse Strip）」
- 在 `TasksPage.tsx` 的 `.task-page-toolbar` 中，打造左统计、右操作的高颜值工具栏：
  - **左侧三枚精致脉冲指标卡（Pulse Chips）**：
    1. **🔥 今日 & 逾期硬仗**：统计 `due_date <= today` 且 `status === "todo"` 的数量（若 `> 0` 展示琥珀/翠绿高亮微点）；
    2. **🎯 项目验收节点**：统计带 `project_name` 且未完成的任务数；
    3. **✨ 已完成闭环**：统计当前未归档列表中 `status === "done"` 的数量，附带迷你进度条。
  - **右侧视图筛选胶囊 + 计划按钮**：
    - 增加一个轻量分组切换按钮组：`全部` | `今日及临期` | `项目节点`（纯前端过滤 `sortedTasks`，零延迟切换）；
    - 保留原有的「📅 每日计划」与「📅 阶段计划」弹窗按钮。

#### 2.3 任务名称与备忘列的「项目验收节点可跳转徽章（Project Link Pill）」
- 当 `task.project_name` 存在时：
  - 在「任务名称」单元格（`.task-title-cell`）或「备忘」单元格左侧，渲染一枚高辨识度的松石绿微胶囊按钮：
    ```tsx
    {task.project_name ? (
      <button
        type="button"
        className="task-project-pill"
        onClick={() => task.project_id ? onNavigate({ name: "project", id: task.project_id }) : onNavigate({ name: "projects" })}
        title={`前往项目：${task.project_name}`}
      >
        <span className="pill-dot" />
        <span>{task.project_name}</span>
        <span className="pill-arrow">↗</span>
      </button>
    ) : null}
    ```
  - 同时保留「备忘」列的 `CellText` 可编辑能力（默认展示 `task.description || task.project_name`）。
- **日期列色温语义化**：在 `TasksPage.tsx` 的任务日期列外层包裹状态类名：若 `task.due_date === today` 赋予 `.is-due-today`（翠绿微底色），若 `task.due_date < today && task.status === "todo"` 赋予 `.is-overdue`（珊瑚红微底色）。

#### 2.4 灵感收集箱（`IdeasPage.tsx`）紧急度视觉强化
- 为 `IdeasDatabase` 顶部标题栏右侧增加分类快速筛选胶囊（`全部` / `项目灵感` / `短期想法` / `长期想法`）；
- 为 `urgency === 1` 的行赋予极淡的暖色左侧指示条（`box-shadow: inset 3px 0 0 var(--danger)`），让高优灵感一眼跳出。

---

## Step 3：「财务中心」日限额温度计、四色消费结构条与高定记账台

### 涉及文件
- `apps/web/src/pages/FinancePage.tsx`
- `apps/web/src/index.css`

### 具体执行要求

#### 3.1 新增顶部「财务态势 Bento 看板（Finance Pulse Board）」
在 `FinancePage.tsx`（当 `activeTab === "expenses"` 或 `"incomes"` 时），在 `.quick-ledger` 上方新增三联 Bento 态势卡 `.finance-pulse-grid`：
1. **卡片一：🍱 今日餐饮限额雷达（Daily Meal Budget Radar）**
   - 自动实时计算今日（`occurred_date === today`）且 `category_minor === "饭费"` 的支出总和 `todayMealCents`（注意：即使当前列表筛选了“本周/本月”，也可通过轻量独立 state 或从当日数据计算今日饭费，建议组件挂载及记账后拉取一次今日支出用于计算 `todayMealCents`）；
   - 对照每日限额 `2500` 分（`¥25.00`），展示：
     - 大号等宽数字：`¥{(todayMealCents / 100).toFixed(2)} / ¥25.00`
     - 动态色温进度条：$\le 80\%$ 为松石翡翠绿（`var(--ok)`），$80\% \sim 100\%$ 为琥珀黄（`var(--warn)`），$> 100\%$ 为超支珊瑚红（`var(--danger)`），并显示剩余或超标金额提示。
2. **卡片二：📊 当前筛选周期收支总览与突发消费监控**
   - 显示当前筛选范围内的总金额、笔数，以及其中「冲动消费」的笔数（0 笔时显示 `✓ 0 冲动消费 · 守线完美` 绿色徽章；$>0$ 时显示琥珀预警）。
3. **卡片三：🎨 四大分类结构占比彩条（Category Distribution Bar）**
   - 汇总当前 `entries` 中各 `category_major`（日常消费、品质生活、固定支出、突发消费、项目支出）的金额占比；
   - 渲染一条高度 `10px`、圆角胶囊状的多段彩色比例条（Stacked Bar）及下方图例圆点 + 百分比，直观呈现钱花在了哪里。

#### 3.2 快捷记账台（Quick Ledger）语义图标与大号等宽金额输入
- 为 `FinancePage.tsx` 中的预设项匹配语义 Emoji 图标映射函数 `getPresetIcon(name)`：
  - `早餐: "🥣"`, `午餐: "🍱"`, `晚餐: "🍲"`, `咖啡: "☕"`, `日用品: "🧻"`, `饮用水: "💧"`, `交通费: "🚇"`, `订阅: "🔄"`, `分期: "💳"`, `电费: "⚡"`, `水费: "🚰"`, `电话费: "📱"`, `冲动消费: "🛍️"`, `医药: "💊"`, `休闲娱乐: "🎮"`, `生活费: "💰"`, 项目类默认 `"🚀"`。
- 将金额输入框改造为带左侧货币符号 `¥` 的高定输入舱，字号提升至 `18px`，开启 `font-variant-numeric: tabular-nums; font-weight: 700;`。

---

## Step 4：「健康底盘」纯 SVG 双轨趋势微画布与 00:30 作息色温感知

### 涉及文件
- `apps/web/src/pages/HealthPage.tsx`
- `apps/web/src/index.css`

### 具体执行要求

#### 4.1 顶部状态卡升级 + 纯原生 SVG 双轨趋势画布（`.health-charts-grid`）
在 `HealthPage.tsx` 的 `.status-strip` 下方、表格上方，新增双栏可视化面板 `.health-charts-grid`（取最近 14 条有效记录按日期升序排列绘制）：
1. **左卡：📉 空腹体重走势与 `< 71.0 kg` 目标线（Weight Trend SVG Area Chart）**
   - 使用响应式 `viewBox="0 0 420 130"` 的纯 SVG 绘制平滑折线与底部渐变填充（`linearGradient` 从 `rgba(21, 78, 63, 0.22)` 到 `rgba(21, 78, 63, 0.0)`）；
   - 绘制一条 `71.0 kg` 对应的水平绿色虚线（`stroke-dasharray="4 4"`），标注 `目标 71.0kg`；
   - 每个数据点绘制圆点 `<circle>` 并展示首尾及极值数值标签，直观展现体重下降趋势；
   - 卡片右上角显示较上一日体重变化徽章（如 `↓ 0.05 kg` 绿色或 `↑ 0.10 kg` 琥珀色）。
2. **右卡：🌙 睡眠时长与 00:30 底线雷达（Sleep & Bedtime Bar Chart）**
   - 绘制最近 14 天的圆角柱状图（柱高代表睡眠小时数）；
   - **柱体颜色自动感知上床时间 `bedtime_local`**：
     - 若上床时间在 `18:00 ~ 23:59` 或 `00:00 ~ 00:30`（守住 00:30 底线）：柱体渲染为清新的松石翡翠绿；
     - 若上床时间在 `00:31 ~ 06:00`（熬夜越线）：柱体渲染为温和的琥珀橙色，一眼看清作息规律度。

#### 4.2 表格内上床时间“色温徽章化”
- 在 `TimeCell` 组件中，根据 `value`（对于上床列）动态附加色温样式类：守住 `00:30` 底线时呈现淡绿微光边框，超过 `00:30` 呈现淡琥珀色文字与提示，无需人脑换算。

---

## Step 5：「计划与复盘」大师级双栏杂志工作台（Editorial Master-Detail Split View）

### 涉及文件
- `apps/web/src/pages/PlansReviewsPage.tsx`
- `apps/web/src/components/ReadOnlyPlanCard.tsx`
- `apps/web/src/index.css`

### 具体执行要求

#### 5.1 每日计划 & 阶段计划重构为「左目录流 + 右沉浸画布」双栏工作台
- **痛点消除**：废除原本“点一下表格行，页面滚到上方/下方内嵌框”的割裂交互。
- 在 `DailyPlanDatabase` 与 `StagePlanDatabase` 中：
  - 页面加载后，若 `selectedPlan` 为空且 `plans.length > 0`，**默认自动选中并打开最新一期（第一条）计划**！
  - 采用 `.editorial-split-layout`（桌面端 `grid-template-columns: 320px minmax(0, 1fr); gap: 20px; align-items: start;`）：
    - **左侧目录栏（`.editorial-sidebar`）**：
      - 顶部为紧凑的新建计划日期选择与按钮；
      - 下方为可滚动的**时间轴卡片列表（`.editorial-nav-list`）**：每张卡片展示日期/周期、状态徽章（`已确认` / `草稿`）、双行文字摘要预览、以及悬浮显示的归档/删除小按钮；当前选中卡片带松石绿左侧高亮条与微阴影。
    - **右侧文档画布（`.editorial-canvas`）**：
      - 顶部呈现杂志级文档抬头（大号日期/周期标题、自动保存状态脉冲点 `● 已自动保存`、状态 Tag、以及 `阅读视图 / 编辑视图` 切换开关）；
      - 支持**「✨ 沉浸阅读视图」与「✍️ 块级编辑视图」一键切换**：
        - **阅读视图**：复用并升级 `PlanRichText` 排版渲染器，将 `#`、`##`、`- [ ]`、`**加粗**` 渲染为带有精美章节卡片、翠绿勾选框和舒适行距的高级排版文档；
        - **编辑视图**：展示原有的 `RichTextBlockEditor`，无缝自动保存。

---

## Step 6：全局细节工艺打磨与强制构建交付验证

### 6.1 全局字体与表格微质感（`apps/web/src/index.css`）
1. **全量等宽数字对齐**：为所有数字敏感元素（`.col-date`、`.col-money`、`.col-number`、`.col-time`、`.status-chip strong`、`.nav-count-pill`）统一加上 `font-variant-numeric: tabular-nums;`。
2. **表格行悬浮与选中微光**：优化 `.database-table tbody tr` 的 hover 过渡，增加左侧 `2px` 透明到松石绿的微妙指示线过渡，提升长表格横向阅读时的行追踪体验。

### 6.2 自动化验证与桌面客户端（EXE）打包同步（绝对执行，缺一不可）
完成上述 Step 1 ~ Step 5 的代码编写后，必须依次执行以下终端命令，确保零报错并完成客户端覆写：

```powershell
# 1. 编译并运行后端全部单元测试（确保 45/45 全部通过）
Set-Location "D:\code\mature project\Personal AI OS"
npm --prefix "apps/server" run build
npm --prefix "apps/server" test

# 2. 验证前端 TypeScript 与 Vite 生产构建零错误
npm --prefix "apps/web" run build

# 3. 打包生成最新桌面端可执行程序（Tauri Release Build）
Set-Location "D:\code\mature project\Personal AI OS\apps\desktop"
npx tauri build --no-bundle

# 4. 运行发布同步脚本（自动关闭旧进程、覆写 release/Personal-AI-OS.exe、更新 zip 并重启新客户端）
Set-Location "D:\code\mature project\Personal AI OS"
node scripts/sync-release.js
```

### 6.3 验收清单（Checklist for Executing AI）
- [ ] `Ctrl+K` 指挥面板在任意页面均可呼出、搜索并跳转，侧边栏显示待办与活跃项目角标；
- [ ] 任务页顶部具备三联脉冲统计条与快速筛选，项目验收节点任务展示可点击跳转项目的松石绿徽章；
- [ ] 财务页顶部展示「今日餐饮 ¥25 限额雷达进度条」与「四色分类占比条」，快捷记账带语义 Emoji 图标；
- [ ] 健康页展示近 14 天「空腹体重面积曲线（含 71.0kg 目标虚线）」与「睡眠时长及 00:30 底线色柱」；
- [ ] 计划与复盘页采用左目录卡片流 + 右沉浸画布双栏布局，默认打开最新计划，支持阅读/编辑视图切换；
- [ ] 服务端测试 100% 通过，`Personal-AI-OS.exe` 已重新构建并同步生效。
