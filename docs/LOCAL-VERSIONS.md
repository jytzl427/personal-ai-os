# 本地版本验收

在现有 personal-ai-os Codex Linux 环境内执行。源环境已绑定保存的配置版本 `cecfgver_6b09cb72e53c819fa15c56784812420d`，本机运行时间与测试均采用 Asia/Shanghai。依赖和启动命令在当前实例实测。将命令用于未来新任务时，需要在 Codex Cloud 环境设置中将其保存到源配置，再发布该配置版本。

## 复测与启动

需要 Node.js、Corepack、curl、Python 3、make 和 C/C++ 编译器。在仓库根目录执行 `bash scripts/codex-linux.sh setup` 安装锁定依赖、构建、检查类型并运行测试。首次启动使用空的测试目录，启动进程可用 Ctrl+C 结束。

```bash
bash scripts/codex-linux.sh setup
export PAIOS_DATA_DIR="$(mktemp -d)"
export PAIOS_PORT=4738
bash scripts/codex-linux.sh serve
```

服务绑定 `127.0.0.1`，脚本设置 `TZ=Asia/Shanghai`。浏览器打开 `http://127.0.0.1:4738`。创建第一个管理员所需的验证码位于数据目录的 `.accounts/setup-code.txt`，成功后该文件即被消费。升级时，原数据目录里的 SQLite、附件、备份和导出保留原位并绑定到第一个管理员。普通账号由管理员在「设置 → 本地账号」创建，分别写入按服务端账号 ID 生成的目录。停用会撤销该账号的会话。

在每个版本提交前运行下列完整检查，使用测试数据库。使用 PAIOS_TEST_LEGACY_COPY 传入旧版服务生成的脱敏测试目录时，测试先复制目录，再验证迁移。该目录需含有旧版数据库和带有合成跨年待办 ID 的 `fixture.json`。

```bash
pnpm build
pnpm typecheck
TZ=Asia/Shanghai pnpm test
```

## origin/main 基线

- 提交 `30514abe2ecda75aa9c4a2bde2fd08eb34aa413e`，Linux x86_64，Node.js 24.22.3，pnpm 9.15.4。
- Web 页面和 JS 资源均为 HTTP 200。SQLite integrity_check 返回 ok，`/api/v1/today` 返回 HTTP 200，业务时区为 Asia/Shanghai。
- 构建和类型检查通过。服务端 47/48 通过。旧失败出现在 `archive retention cleans only short-lived records after the seven-day interval`，记录删除后 Linux 附件文件因路径分隔符判断而残留。

## v1.0

- Web 账号初始化、登录、创建和停用通过 Chromium 无头浏览器验证，使用两个独立浏览器会话。新服务的未登录 `/api/v1/today` 返回 401，登录后返回 200。
- 用基线服务生成的旧库副本测试了详情、搜索、跨账号修改与关联、导出和停用。跨年归档待办恢复后，到期日仍为 `2027-01-02`，另一账号的完整 SQLite 序列化 SHA-256 一致。
- 附件路径修复同时识别 Linux 和旧 Windows 库中的路径形式。`bash scripts/codex-linux.sh setup` 的冻结安装、构建、类型检查和全量测试通过，服务端 49/49。桌面检查覆盖仓库的 scaffold 命令。

## v1.1

- 真实 MCP stdio 通过两账号测试。无凭证或旧凭证会被拒绝，只读授权无法新增，跨账号读取和追加备注均被拒绝。新增普通待办、追加备注、写入审计和相同调用键的安全重试通过。
- 在同一个已连接的客户端中撤销授权，下一次调用和工具列表读取立即失败。另一账号仍可查询。直连模式还验证了 Web 停止后的本地调用、待恢复状态拒绝，以及暂停和恢复 Web 服务后对撤权的重新检查。
- Chromium 无头浏览器验证了权限默认未选、签发只读凭证、校验、轮换和撤销。`bash scripts/codex-linux.sh setup` 完整通过，服务端 49/49。

## v1.2

在 Linux 中，服务默认关闭内置 AI。使用 Python 3、Linux 开发头文件和 C 编译器构建隔离进程后，可在独立数据目录启动本地模拟。浏览器中的「内置 AI」会显示「本地模拟」。登录后逐项授权待办权限。

```bash
export PAIOS_DATA_DIR="$(mktemp -d)"
PAIOS_AI_MODE=mock bash scripts/codex-linux.sh serve
```

服务端可通过 `PAIOS_AI_MODE=openai` 选择固定模型入口，凭证仅由服务端的 `PAIOS_AI_MODEL_API_KEY` 环境变量提供。模型请求使用 `gpt-4o-mini` 和固定 HTTPS 地址 `https://api.openai.com/v1/chat/completions`。工作进程只有受限的标准流，服务端负责转发固定模型请求与执行获准的待办操作。旧的可编辑模型地址和旧调用入口对账号服务关闭，旧对话记录保留在各自数据库。

改期、完成和删除均需本人确认。确认与账号、登录会话、授权版本、操作、待办和待办版本绑定，改期还绑定新日期。请求在五分钟后过期。写入、一次性确认标记和审计记录在同一个 SQLite 事务中提交。

- 同一个普通测试账号通过查询、新增和备注测试。授权撤销、其他账号的待办、未授权业务接口、替换确认对象或日期、换会话以及重复确认均被拒绝。旧版本待办变更后，原确认失效。
- 已验证改期、完成和删除先保持待办不变，经本人操作后才写入，并生成包含确认动作与目标待办的审计记录。Chromium 无头浏览器通过授权、模拟标识和改期确认。模型文本中的确认声明未触发写入。
- 子进程的额外 seccomp 过滤器、单线程和 `NoNewPrivs=1` 已从 `/proc` 读取验证。用合成源码、合成管理员凭证、测试库及合成备份检查了文件读取拒绝，普通 socket 创建也被阻止。当前环境的 Landlock 查询返回 `ENOSYS`，文件系统拒绝由内核系统调用过滤器验证。测试仅覆盖预期操作及拒绝。 [Linux seccomp 文档](https://docs.kernel.org/userspace-api/seccomp_filter.html) [Linux Landlock 文档](https://docs.kernel.org/userspace-api/landlock.html)
- `bash scripts/codex-linux.sh setup` 完整通过，服务端 52/52，包含旧库副本迁移回归。模型端使用本地模拟。真实模型连通性、Windows 原生应用和 v1.3 上线均待独立验证。
