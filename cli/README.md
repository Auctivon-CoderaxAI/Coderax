# @coderax/cli

Command-line client for a Coderax deployment: chat, agents, models and Cloud
status from a terminal.

```bash
npm link                                  # exposes `coderax`
unset CODERAX_BASE_URL CODERAX_TOKEN
coderax config set base-url https://your-deployment.example
read -rsp "Coderax API token: " token; echo
printf '%s\n' "$token" | coderax login   # probes /api/user before storing
unset token
coderax doctor                            # configuration, credentials, connectivity
```

`coderax login` sends the token to `/api/user` before storing it. A successful
probe identifies the account; a 404 is accepted because older deployments may not
expose that endpoint, and any other rejection aborts the login. The example clears
`CODERAX_BASE_URL` and `CODERAX_TOKEN` first; both override stored configuration
and would otherwise change which deployment or token is used. `coderax --help`
lists every command, the `--json`, `--base-url` and `--model` overrides, and the
exit codes. Credentials are written with `0600` permissions where the platform
enforces POSIX modes.
