# Personal AI OS

本地优先的个人 AI 管家：**数据库 + 可视化 Web** 是身体，**MCP + Skill** 是钥匙，**AI 管家** 优先外接任意 Agent。

当前状态：本地单用户 Windows 应用已进入可用阶段。数据库、页面、MCP、页内管家计划/复盘/项目推进闭环和单文件 EXE 均已落地。收尾项（统一业务网关抽取、外部 Agent 长流程、前端 E2E、安装包）见 [`docs/CURRENT-STATE.md`](docs/CURRENT-STATE.md)。

- 接手请先读：[交付手册](docs/交付手册.md)
- `docs/PLAN.md` 和 `docs/plans/` 是历史设计，不是当前待办

## 📥 快速下载（免安装绿色版）

无需安装 Node.js 或 Rust 环境，直接下载解压即可开箱即用：

👉 **[前往最新发行版页面 (GitHub Releases v1.1)](https://github.com/jytzl427/personal-ai-os/releases/tag/v1.1)**
- **推荐下载**：[`Personal-AI-OS-v1.1-windows-x64.zip`](https://github.com/jytzl427/personal-ai-os/releases/download/v1.1/Personal-AI-OS-v1.1-windows-x64.zip)（仅 36.5 MB，解压直接双击运行）
- **单文件可执行程序**：[`Personal-AI-OS.exe`](https://github.com/jytzl427/personal-ai-os/releases/download/v1.1/Personal-AI-OS.exe)

---

## 🛠️ 从源码开发与本地运行

需要 Node 20+ 和 pnpm。

```bash
pnpm install
pnpm dev
```

开发时打开 `http://127.0.0.1:5173`；生产态使用 `pnpm start`，服务与 Web 统一运行在 `http://127.0.0.1:4738`。

正式运行和手动启动服务默认使用 `%USERPROFILE%\\.paios\\`；如果要隔离开发数据，请显式设置 `PAIOS_DATA_DIR=.data`，首次启动会自动创建 SQLite、三账户、工作流 seed 和 MCP 开发 token。备份位于对应数据目录的 `backups/`。

恢复备份前请先关闭正在使用同一数据目录的直连 MCP；程序会自动检测 MCP 占用并拒绝并发替换数据库。若主数据库已经损坏、图形界面无法启动，可先关闭所有 Personal AI OS 进程，再运行 `release/Personal-AI-OS.exe --restore-latest`，它会选择最近一份通过完整性校验的本地备份进行恢复，并把损坏主库保留为安全副本。

当前已完成：pnpm workspace、SQLite WAL/schema/seed、单写者锁、任务/项目/阶段/依赖、财务三分（支出、收入、账户流水）、健康、每日/阶段计划和复盘、归档中心、确认票、浅色 Web 独立页面、带 token/scope 的 MCP stdio、EXE 直接 MCP 模式、页内 AI 管家真实工具循环（含阶段计划草案、due_date 执行日期、未确认阶段计划不得推进项目）、连接测试和 `skills/paios`。

桌面壳位于 `apps/desktop/`。给自己使用时直接双击 `release/Personal-AI-OS.exe` 即可，不需要安装 pnpm、Node，也不需要旁边的 `resources` 文件夹；程序首次启动会自动准备内部运行时，数据默认位于 `%USERPROFILE%\\.paios\\`。外部 Agent 使用时配置同一个 EXE 加 `--mcp` 参数，Agent 会自动启动无界面的直接 MCP 模式，不需要你先打开界面。开发或重新构建使用 `pnpm --filter @paios/desktop tauri:build`；若只生成 EXE 而跳过安装包，必须使用 `cargo build --release --features custom-protocol`，否则窗口会连接开发地址。

P8 的后续扩展路线见 [`docs/ROADMAP.md`](docs/ROADMAP.md)，当前不预建投资、习惯或附件表。

- 交付手册：[docs/交付手册.md](docs/交付手册.md)