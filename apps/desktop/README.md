# Personal AI OS desktop shell

This is the P7 Tauri 2 shell. It loads the existing Web UI and starts the bundled local server with:

- bind: `127.0.0.1`
- port: `4738`
- data directory: `%USERPROFILE%\\.paios\\`

The build prepares a standalone Node server resource and SQLite native module before compiling. Run `pnpm --filter @paios/desktop tauri:build` on Windows to produce the EXE and MSI under `src-tauri/target/release/`.

The EXE built from this source also supports `--mcp`. It runs the account-scoped stdio adapter with the grant in `PAIOS_TOKEN`. The adapter uses the local service when available and opens the authorized account's store under the writer lock otherwise.
