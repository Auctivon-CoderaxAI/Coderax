# @coderax/cli

Command-line client for a Coderax deployment: chat, agents, models and Cloud
status from a terminal.

```sh
npm link                                  # exposes `coderax`
coderax config set base-url https://your-deployment.example
coderax login --token "<token>"           # verified before it is stored
coderax doctor                            # configuration, credentials, connectivity
```

`coderax --help` lists every command, the `--json`, `--base-url` and `--model`
overrides, and the exit codes. `CODERAX_BASE_URL` and `CODERAX_TOKEN` override
stored configuration; credentials are written with `0600` permissions.
