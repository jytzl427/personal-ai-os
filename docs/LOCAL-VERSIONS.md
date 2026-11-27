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
