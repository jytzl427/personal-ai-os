# Registering Personal AI OS

For normal use, the Agent should launch the single EXE in direct MCP mode. The graphical workbench does not need to be open and no HTTP service or development server is required. Create or rotate an Agent token once in the app's Settings page; do not read a token from `.data/mcp-token.txt`.

```json
{
  "mcpServers": {
    "paios": {
      "command": "<path-to-repo>\\release\\Personal-AI-OS.exe",
      "args": ["--mcp"],
      "env": {
        "PAIOS_TOKEN": "<copy the token created in Personal AI OS Settings>"
      }
    }
  }
}
```

Replace the EXE path if it was moved. In direct mode the bundled MCP process opens the user's personal database itself and exits with the Agent session. After connecting, call `system_status` and verify that `dataDir` is the user's personal `.paios` directory. If it points to the repository `.data` directory, stop: that is the development database. Do not start `pnpm dev`, `node ... serve`, or a replacement HTTP service from the Agent. The browser is the only place where confirmation tickets may be approved.

The old `pnpm --filter @paios/server mcp` configuration is retained only for development debugging when an HTTP service is intentionally running; it is not the production Agent configuration.
