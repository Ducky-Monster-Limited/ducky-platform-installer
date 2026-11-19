# ducky-platform-installer

Installs the ducky pro platform locally on macOS (Apple silicon) at
`https://ducky.localhost` (app) and `https://api.ducky.localhost` (api), and
gives you the `ducky` command. Plan: `plan_0011` §4 (ducky_platform_shared).

## What a machine needs

One install for everyone on the team (plan_0013): the code as git clones
of the org's repos, the team's shared secrets from `ducky-secrets`
(sops + age, decrypted with the machine's ssh key), no hand-kept secret
file anywhere. The only credential is the machine's **GitHub ssh key**:

1. The `github` step finds `~/.ssh/id_ed25519` or creates it (ssh-keygen
   asks a passphrase; the macOS keychain keeps it).
2. It puts the public key on your GitHub account: with the `gh` cli when
   you are signed in to it (asked), else it copies the key, opens
   github.com/settings/ssh/new and waits until GitHub knows it.
3. It checks the org's repos are reachable; if not, an org owner adds
   your account to `Ducky-Monster-Limited`.
4. Someone who can already read the secrets adds you as a reader once:
   `node ducky_platform_shared/scripts/secrets.js recipients add <your login>`
   (README of ducky-secrets), then you `ducky-pro update`.

The repos are cloned as siblings under `<root>/repos` (their relative
symlinks resolve), `ducky_secrets` among them. A fresh clone has no
`env.json` (git ignores it); the envs start from the committed
`env.base.json` (no secrets), the install mints its own machine secrets
(`config/secrets.json`, 0600: session secrets, client pair, the key that
encrypts the database's provider keys), and the one-time provider key
import reads `dev.json` of ducky-secrets.

## Install

On a new Mac, in Terminal:

```
curl -fsSL https://raw.githubusercontent.com/Ducky-Monster-Limited/ducky-platform-installer/main/install.sh | bash
```

It installs what is missing (Xcode tools, Homebrew, node, the GitHub
cli), signs you in to GitHub in the browser (the account that is in
`Ducky-Monster-Limited`), asks where to install (default
`~/Workspace/ducky_pro`), clones this installer to `<root>/installer`
and runs the guided `ducky-pro install`. This repo is public on purpose:
it holds no secret, the platform repos are private (org members only)
and the secrets open only for the GitHub keys in ducky-secrets.

From a checkout: `./install.sh --path ~/Workspace/ducky_pro`.

The install root is `--path <dir>` (or `--root`), else `DUCKY_HOME`, else
the folder you run it in (never the home folder itself, never this repo).
`--dev` is accepted and changes nothing (there is one install).

Guided: every step shows what it will do and asks first. Re-running is
safe (each step checks before it acts). Flags: `--dry-run`, `--yes`
(non-sudo steps without asking), `--no-sudo` (list the sudo steps for a
person instead), `--skip a,b`, `--only a,b`. A `clone_base` in
`config/ducky.json` clones from a local folder instead of GitHub (tests,
a machine whose key is not on GitHub yet).

Never touched: an existing mongod (reused as it is: config, dbpath, data),
other nginx server files, nginx.conf, other launchd agents. Sudo is only
ever asked for: trusting the mkcert CA (when not trusted yet), an
`/etc/hosts` block (only when macOS does not resolve `*.localhost`
itself), reloading a root-owned nginx.

## Commands

`ducky-pro install | start | stop | status | update | health | logs [api|app|local|sidequest|nginx] [-f] | link`

`ducky-pro start` ends with the boot pull: `POST https://api.ducky.localhost/api/0.1.0/local/pull`
(gate only, no session or client key, through nginx). It never blocks the
start, it prints one line:

| answer | line |
|---|---|
| 200 `{ pulled, removed, ts }` | `pull: <n> pulled, <n> removed` |
| 409 not linked | `pull: this machine is not linked yet, open https://ducky.localhost/local/link` |
| 401 `This machine is unlinked.` (revoked) | the message, and the link page to link again |
| 503 cloud offline | `pull: the cloud is offline, working from the last pull` |
| anything else | `pull: not done (<status>)` |

The api also pulls by itself about 5 s after it starts, so the hook matters
when the api was already running. `ducky-pro status` shows the link as linked,
not linked or unlinked (revoked).

The other commands find the install by `--path`, else `DUCKY_HOME`, else
the nearest folder up from where you are that holds `config/ducky.json`,
else the last install (remembered in this repo's `.ducky_home`, ignored by
git). A second instance sets `instance` and shifted ports in its
`config/ducky.json`.

## Tests

```
node test/run.js                                     # steps twice on a temp home (clones the workspace's committed HEADs), nothing outside touched
node test/localhost-cookies.js                       # *.localhost cookies + CORS in a real Chrome
node test/pull.js                                    # ducky-pro start's pull hook: 200 / 409 / 401 / 503 lines on a fake api
```
