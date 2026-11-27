# 本地 MCP 授权

在 Web 的「设置 → MCP 授权」逐项选择权限。账号拥有各自的凭证，创建或轮换时可复制连接配置。连接中的 `PAIOS_TOKEN` 来自同一个账号的授权。授权撤销、轮换或账号停用后，原凭证会在下一次工具调用时失效，已有 stdio 连接也会重新验证。

源码构建后可以运行 `node apps/server/dist/main.js mcp`。在线模式读取 `PAIOS_URL`，默认连接 `http://127.0.0.1:4738`。`mcp-direct` 在 Web 关闭时按调用持有本地写入锁。Web 运行时，同一连接走服务端授权接口。用构建后的桌面程序时，可直接使用 `Personal-AI-OS.exe --mcp`。

| 授权范围 | 工具 | 用途 |
| --- | --- | --- |
| `tasks:read` | `today_get`、`tasks_list`、`tasks_get` | 分别读取今日待办、搜索待办和读取待办详情 |
| `tasks:create` | `tasks_create` | 新增普通待办，默认 P2，状态为待办 |
| `tasks:note` | `tasks_append_note` | 向当前账号未完成的待办追加备注 |

`paios://today` 与 `today_get` 使用同一个读取授权。查询按本地日期解释 `due_date`。每次写入同时记录账号、凭证 ID 和待办 ID。写入可传入 `idempotency_key`，使用同一凭证以相同参数重试会返回原结果。用于工具配置的凭证只在签发或轮换时返回。

旧版本的共享凭证需要在各账号内重新签发。项目、财务、健康、回顾、账号管理、导出、确认和备份仍由 Web 中对应功能处理。
