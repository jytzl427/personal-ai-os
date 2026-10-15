# Personal AI OS desktop shell

This is the P7 Tauri 2 shell. It loads the existing Web UI and starts the bundled local server with:

- bind: `127.0.0.1`
- port: `4738`
- data directory: `%USERPROFILE%\\.paios\\`

The build prepares a standalone Node server resource and SQLite native module before compiling. Run `pnpm --filter @paios/desktop tauri:build` on Windows to produce the EXE and MSI under `src-tauri/target/release/`.

The packaged EXE also supports `--mcp`. In that mode it hides the graphical window, starts the bundled direct stdio MCP process, opens `%USERPROFILE%\\.paios\\paios.db` through the server's business routes, and exits when the Agent session ends. This mode does not require the Web UI or port `4738` to be running.
