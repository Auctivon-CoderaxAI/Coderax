# @coderax/cli

Command-line client for a Coderax deployment: chat, agents, models and Cloud
status from a terminal.

```bash
npm link                                  # exposes `coderax`
coderax config set base-url https://your-deployment.example
read -rsp "Coderax API token: " token; echo
printf '%s\n' "$token" | coderax login   # probes /api/user before storing
unset token
coderax doctor                            # configuration, credentials, connectivity
```

`coderax login` sends the token to `/api/user` before storing it. A successful
probe identifies the account; a 404 is accepted because older deployments may not
expose that endpoint, and any other rejection aborts the login. `coderax --help`
lists every command, the `--json`, `--base-url` and `--model` overrides, and the
exit codes. `CODERAX_BASE_URL` and `CODERAX_TOKEN` override stored configuration;
credentials are written with `0600` permissions where the platform enforces
POSIX modes.
