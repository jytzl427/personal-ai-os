# Registering Personal AI OS

In the app's settings, create an MCP grant for the current account and select the required scopes. Copy the configuration displayed when the grant is issued.

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

After connecting, list the tools for the current grant. With the read scope, `today_get` reports the current account's date and today's tasks. Long-running connections recheck authorization on each call.
