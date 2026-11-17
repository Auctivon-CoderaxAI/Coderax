# @coderax/cli

Command-line client for a Coderax deployment: chat, Work mode, agents, models,
product status and Cloud availability from a terminal.

## Install and sign in

```bash
npm link &&
  unset CODERAX_BASE_URL CODERAX_TOKEN &&
  coderax config set base-url https://your-deployment.example &&
  read -rsp "Coderax API token: " token &&
  echo &&
  printf '%s\n' "$token" | coderax login
unset token
coderax doctor
```

`coderax login` sends the token to `/api/user` before storing it. A successful
probe identifies the account; a 404 is accepted because older deployments may
not expose that endpoint, and any other rejection aborts the login. The example
clears `CODERAX_BASE_URL` and `CODERAX_TOKEN` first; both override stored
configuration and would otherwise change which deployment or token is used.
Piping the token from `read` keeps it out of process arguments and shell history,
and the setup lines are chained with `&&` so login does not run if configuration
or reading the token fails. Credentials are written with `0600` permissions where
the platform enforces POSIX modes.

On Windows, `coderax doctor` may report the `config-dir` check as failed even
when the configuration is correct. Windows does not expose POSIX directory
modes, so a directory created with mode `0700` may be reported as `0666`, and the
`chmod 700` hint does not apply. Login and the remaining checks still work, but
`doctor` exits nonzero because its overall result includes this check.

## Commands

### Chat and Work

```bash
coderax chat "Summarize this repository"
coderax work "Draft a release checklist"
```

Both commands stream a response and accept the prompt as positional arguments.
`--model <id>` overrides the configured model for one invocation; `--json`
prints the assembled response as JSON. Both require a configured base URL and a
stored token.

### Models and agents

```bash
coderax models
coderax agents
```

`models` lists the models available to the authenticated account. `agents`
lists its agents with id, name and description. `--json` prints machine-readable
JSON.

### Products and Cloud

```bash
coderax products
coderax cloud
coderax projects
```

`products` reports the real launch state of Desktop, CLI, Web, Cloud and Chat.
`cloud` reports Cloud availability and its roadmap; it exits with code 6 while
Cloud is unavailable. `projects` lists Cloud projects once Cloud ships and
currently exits with code 6 without executing anything.

### Account and configuration

```bash
read -rsp "Coderax API token: " token &&
  echo &&
  printf '%s\n' "$token" | coderax login
unset token
coderax status
coderax logout
coderax config list
coderax config get base-url
coderax config set base-url https://your-deployment.example
coderax config set model "<model-id>"
coderax doctor
coderax update
```

`status` shows the configured API, authentication source and config directory.
`login` reads a token from stdin; it does not prompt interactively, so pipe or
redirect input (the silent `read` example above avoids shell history). `logout`
removes stored credentials. Config keys are `base-url`, `chat-path`, `endpoint`
and `model`. `doctor` checks Node, the config directory, base URL,
authentication and `GET /api/health`; it exits nonzero if any check fails.
`update` prints how to update this unpublished build.

## Options and exit codes

Global options: `--json`, `--base-url <url>`, `--model <id>`, `--help` and
`--version`. `coderax --help` lists the full command set.

| Code | Meaning |
| --- | --- |
| 0 | success |
| 1 | error |
| 2 | usage |
| 3 | unauthenticated |
| 4 | network error |
| 5 | not found |
| 6 | unavailable |
| 130 | cancelled |

`CODERAX_BASE_URL` and `CODERAX_TOKEN` override stored configuration.
`CODERAX_CONFIG_DIR` changes the configuration directory; `CODERAX_CHAT_PATH`,
`CODERAX_ENDPOINT` and `CODERAX_MODEL` override the corresponding settings.
