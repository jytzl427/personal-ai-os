# Personal AI OS

本地优先的个人 AI 管家：**数据库 + 可视化 Web** 是身体，**MCP + Skill** 是钥匙，**AI 管家** 优先外接任意 Agent。

当前源码提供本地多账号和独立 MCP 授权。首次设置和 Linux 验收记录见 [本地版本验收](docs/LOCAL-VERSIONS.md)。已有 Windows 下载包对应各自的发布版本。

- 接手请先读：[交付手册](docs/交付手册.md)
- 版本演进见 [更新记录](docs/CHANGELOG.html)

## 📥 快速下载（免安装绿色版）

无需安装 Node.js 或 Rust 环境，直接下载解压即可开箱即用：

[查看 GitHub 已发行的 Windows 下载包](https://github.com/jytzl427/personal-ai-os/releases)。从当前源码打包的步骤见 [交付手册](docs/交付手册.md#11-开发构建和测试)。

---

## 🛠️ 从源码开发与本地运行

需要 Node 20+ 和 pnpm。

```bash
pnpm install
pnpm dev
```

开发时打开 `http://127.0.0.1:5173`；生产态使用 `pnpm start`，服务与 Web 统一运行在 `http://127.0.0.1:4738`。

正式运行和手动启动服务默认使用用户目录下的 `.paios`。开发时请指定独立的 `PAIOS_DATA_DIR`。首次登录在 Web 中创建管理员，原有业务数据自动归入该账号。备份位于各自数据目录的 `backups/`。

恢复备份前请先关闭正在使用同一数据目录的直连 MCP；程序会自动检测 MCP 占用并拒绝并发替换数据库。若主数据库已经损坏、图形界面无法启动，可先关闭所有 Personal AI OS 进程，再运行 `release/Personal-AI-OS.exe --restore-latest`，它会选择最近一份通过完整性校验的本地备份进行恢复，并把损坏主库保留为安全副本。

Web 提供任务、项目、财务、健康、计划与复盘、归档、确认和备份。外部 Agent 通过 [MCP 授权](docs/MCP.md) 使用所在账号批准的待办工具。

桌面壳位于 `apps/desktop/`。给自己使用时直接双击 `release/Personal-AI-OS.exe` 即可，不需要安装 pnpm、Node，也不需要旁边的 `resources` 文件夹；程序首次启动会自动准备内部运行时，数据默认位于 `%USERPROFILE%\\.paios\\`。外部 Agent 使用时配置同一个 EXE 加 `--mcp` 参数，Agent 会自动启动无界面的直接 MCP 模式，不需要你先打开界面。开发或重新构建使用 `pnpm --filter @paios/desktop tauri:build`；若只生成 EXE 而跳过安装包，必须使用 `cargo build --release --features custom-protocol`，否则窗口会连接开发地址。

后续扩展路线见 [`docs/ROADMAP.md`](docs/ROADMAP.md)。
