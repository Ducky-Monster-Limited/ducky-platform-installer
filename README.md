# ducky-platform-installer

Installs the ducky pro platform locally on macOS (Apple silicon) at
`https://ducky.localhost` (app) and `https://api.ducky.localhost` (api), and
gives you the `ducky` command. Plan: `plan_0011` §4 (ducky_platform_shared).

## Two modes

| | release (the default) | dev (`--dev`, Marc's machines) |
|---|---|---|
| code | versioned bundles (release assets of this repo, `bundle-<n>`) | git clones of the repos |
| needs | a personal read-only release token | GitHub access to the org's repos |
| v4 source | none (only the files `services.system` reads) | `ducky_design` cloned read-only |
| `ducky update` | the next bundle only | `git pull --ff-only` per repo |
| runs as | `NODE_ENV=production`, the builds' versions | `NODE_ENV=development` |

The cloud keeps a release-mode person limited: their own pro account
(device link), only the workspaces they are invited to, provider keys
pulled only for workspace owners/admins.

## Install

```
git clone https://github.com/Ducky-Monster-Limited/ducky-platform-installer.git
cd ducky-platform-installer
./install.sh            # release mode: asks for your release token
./install.sh --dev      # dev mode
```

Guided: every step shows what it will do and asks first. Re-running is
safe (each step checks before it acts). Flags: `--dry-run`, `--yes`
(non-sudo steps without asking), `--no-sudo` (list the sudo steps for a
person instead), `--skip a,b`, `--only a,b`, `--token-file <file>`.

Never touched: an existing mongod (reused as it is: config, dbpath, data),
other nginx server files, nginx.conf, other launchd agents. Sudo is only
ever asked for: trusting the mkcert CA (when not trusted yet), an
`/etc/hosts` block (only when macOS does not resolve `*.localhost`
itself), reloading a root-owned nginx.

## Commands

`ducky install | start | stop | status | update | doctor | logs [api|app|local|sidequest|nginx] [-f] | link`

`DUCKY_HOME` (default `~/Ducky`) picks the install; a second instance
sets `instance` and shifted ports in its `config/ducky.json`.

## Release tokens (coordinator / Marc)

Mint one per person, never share one:

1. github.com → Settings → Developer settings → Fine-grained personal
   access tokens → Generate new token.
2. Name `ducky-release-<person>`, resource owner `Ducky-Monster-Limited`,
   expiration 90 days (renew by minting a new one).
3. Repository access: Only select repositories → `ducky-platform-installer`.
4. Repository permissions: Contents → Read-only (Metadata read-only is
   added by GitHub). Nothing else.
5. If the org requires approval for fine-grained tokens, approve it under
   the org's Settings → Personal access tokens → Pending requests.
6. Hand the token over privately; the person pastes it at install (stored
   in `~/Ducky/config/release_token`, 0600, never printed).

Revoke: delete the token (Developer settings → Fine-grained tokens), or as
org owner revoke it under the org's Settings → Personal access tokens →
Active tokens. The person's `ducky update` then fails with "token revoked
or expired"; their install keeps running the bundle it has. Revoke their
device link on the cloud too (account settings → devices) to stop pulls.

With this token a person can read this repo and download its release
assets, nothing else in the org.

## Publishing a bundle (part of a pro release)

After a pro release (`/apps-deploy`: `build/0.0.1-pro-rc<N>/` committed on
the api and the pro app's main):

```
node scripts/release-bundle.js --n <next bundle number> --out /tmp/ducky-bundle-<n>/bundle-<n>
node test/run.js --bundle /tmp/ducky-bundle-<n>      # install twice on a temp home
node scripts/release-bundle.js --n <n> --out … --publish --yes   # tell the coordinator first
```

The bundle carries the api and app release builds (self-contained), the
local migrations, base envs with every credential masked (the build fails
on a leak), `local-envs.js`, the pro cli copy (freeze ref + the build's
patches + marker, no `.git`) and only `lib/system-defaults.json`,
`themes/`, `v4/tokens.css` of `ducky_design` at a pinned commit.
`manifest.json` lists every source sha and each archive's sha256; the
installer refuses an archive whose hash differs.

## Tests

```
node test/run.js --bundle <dir holding bundle-<n>/>   # steps twice on a temp home, nothing outside touched
node test/localhost-cookies.js                       # *.localhost cookies + CORS in a real Chrome
```
