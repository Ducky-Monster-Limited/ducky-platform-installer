// release-bundle.js — builds a release bundle for release-mode installs
// (people outside Marc's machines): no git history, no v4 source.
//
// A bundle = one GitHub release on the installer repo, tag bundle-<n>, with
// these assets:
//   api.tar.gz     the api's release build (build/<api tag>/ on the api's
//                  main: self-contained, no symlinks) + its local
//                  migrations + env.base.json (secrets masked)
//   app.tar.gz     the pro app's release build (build/<app tag>/) +
//                  env.base.json (secrets masked)
//   shared.tar.gz  scripts/local-envs.js + config/apps.json
//   cli.tar.gz     the pro cli copy: the cli at the freeze ref + the api
//                  build's patches + the marker (.pro_cli.json) + the css
//                  past (.pro_cli_past.json), without .git — as the worker
//                  image carries it
//   design.tar.gz  only the files services.system reads (catalog, themes,
//                  tokens) at a pinned ducky_design commit
//   manifest.json  versions, source shas, file names, sha256 per archive
//
// usage:
//   node scripts/release-bundle.js --n <bundle number> [--out <dir>]
//        [--workspace <dir>] [--api-build <tag>] [--app-build <tag>]
//        [--cli-ref <ref>] [--design-ref <ref>] [--shared-ref <ref>]
//        [--publish --yes]
//
// Without --publish it only builds into --out (a local dry run). --publish
// creates the GitHub release with `gh` — tell the coordinator first.

let child_process = require('child_process')
let crypto        = require('crypto')
let fs            = require('fs')
let os            = require('os')
let path          = require('path')

// ---

let org  = 'Ducky-Monster-Limited'
let repo = 'ducky-platform-installer'

/**
 * One command line value.
 *
 * @param   {string} name     - The flag
 * @param   {*}      fallback - The value when missing
 * @returns {*} The value
 */
function arg(name, fallback) {

    let index = process.argv.indexOf(name)

    return index !== -1 && process.argv[index + 1] && !/^--/.test(process.argv[index + 1]) ? process.argv[index + 1] : fallback

}

/**
 * Runs a command, throws on failure (the command named, never its env).
 *
 * @param   {string} cmd     - The program
 * @param   {array}  args    - Its arguments
 * @param   {object} options - cwd, env
 * @returns {string} stdout
 */
function run(cmd, args, options) {

    let result = child_process.spawnSync(cmd, args, Object.assign({ encoding : 'utf8', maxBuffer : 1024 * 1024 * 1024 }, options || {}))

    if (result.status !== 0) throw new Error(cmd + ' ' + args.slice(0, 3).join(' ') + ' failed: ' + String(result.stderr || '').trim().split('\n').slice(-1)[0])

    return result.stdout

}

/**
 * Extracts a tree of a repo at a ref into a folder (git archive).
 *
 * @param {string} dir_repo - The repo
 * @param {string} treeish  - <ref>:<path> or <ref>
 * @param {string} paths    - Paths inside the tree ([] = all)
 * @param {string} target   - The folder
 */
function setArchive(dir_repo, treeish, paths, target) {

    fs.mkdirSync(target, { recursive : true })
    run('/bin/bash', ['-c', 'set -o pipefail; git -C "$REPO" archive --format=tar "$TREE" ' + paths.map(function(item) { return '"' + item.replace(/"/g, '') + '"' }).join(' ') + ' | tar -x -C "$TARGET"'], {
        env : Object.assign({}, process.env, { REPO : dir_repo, TARGET : target, TREE : treeish })
    })

}

/**
 * The highest pro release build folder on a repo's origin/main.
 *
 * @param   {string} dir_repo - The repo
 * @returns {string} The tag (0.0.1-pro-rc<N>)
 */
function getLatestBuild(dir_repo) {

    let names = run('git', ['-C', dir_repo, 'ls-tree', '--name-only', 'origin/main', 'build/']).split('\n').map(function(line) {

        return line.replace(/^build\//, '')

    }).filter(function(name) {

        return /^0\.0\.1-pro-rc\d+$/.test(name)

    }).sort(function(a, b) {

        return Number(a.split('rc')[1]) - Number(b.split('rc')[1])

    })

    if (!names.length) throw new Error('no pro build folder on ' + dir_repo + ' origin/main')

    return names[names.length - 1]

}

/**
 * Masks every credential-like value of an env (as deploy-stage-pro.js):
 * null. Paths into the dev workspace become $REPOS/ paths when they
 * point at a bundled repo, else null.
 *
 * @param   {object} node      - The env (changed in place)
 * @param   {string} workspace - The dev workspace root
 * @returns {object} The env
 */
function setMasked(node, workspace) {

    Object.keys(node).forEach(function(key) {

        let value = node[key]

        if (value && typeof value === 'object') return setMasked(value, workspace)
        if (typeof value !== 'string') return

        if (value.indexOf(workspace + '/') === 0) {
            node[key] = /^(ducky_design|ducky_cli)\//.test(value.slice(workspace.length + 1)) ? '$REPOS/' + value.slice(workspace.length + 1) : null
            return
        }
        if (/(secret|password|token|_key$|^key$|private|apikey|api_key)/i.test(key) || /:\/\/[^/]*:[^/]*@/.test(value) || /^(sk[-_]|AIza|AKIA|ghp_|xox)/.test(value) || /^\/(Users|home|private|tmp)\//.test(value)) {
            node[key] = null
            return
        }
        if (/^[A-Za-z0-9_\-+/=]{20,}$/.test(value) && /\d/.test(value) && /[A-Za-z]/.test(value)) node[key] = null

    })

    // vendors carry account ids and keys: none ship
    if (node.services && node.services.vendors) node.services.vendors = {}

    return node

}

/**
 * Fails when a staged env still carries a credential-like value.
 *
 * @param {string} file - The env file
 */
function setLeakCheck(file) {

    let text = fs.readFileSync(file, 'utf8')
    let leak = /"(access_key_id|secret_access_key|secret|password|client_secret|client_key|secret_key|token)": "[^"]+"/.exec(text)
        || /"([a-z_]+)": "(sk[-_]|AIza|AKIA|ghp_|xox)[^"]*"/.exec(text)
        || /"([a-z_]+)": "[A-Za-z0-9_\-+/=]*\d[A-Za-z0-9_\-+/=]{19,}"/.exec(text)
        || /"([a-z_]+)": "\/Users\//.exec(text)

    // the key only, never the value
    if (leak) throw new Error('a credential-like value would ship in ' + path.basename(path.dirname(file)) + '/' + path.basename(file) + ' under "' + leak[1] + '"')

}

/**
 * Drops symlinks that point outside a folder (absolute, or escaping):
 * on another machine they dangle.
 *
 * @param {string} dir  - The folder walked
 * @param {string} root - The folder links must stay in
 */
function setLinksDropped(dir, root) {

    fs.readdirSync(dir, { withFileTypes : true }).forEach(function(entry) {

        let full   = path.join(dir, entry.name)
        let target = null

        if (entry.isDirectory()) return setLinksDropped(full, root)
        if (!entry.isSymbolicLink()) return

        target = fs.readlinkSync(full)

        if (path.isAbsolute(target) || path.resolve(dir, target).indexOf(root + path.sep) !== 0) {
            console.log('[info] dropped the outside link ' + entry.name + ' -> ' + target)
            fs.unlinkSync(full)
        }

    })

}

/**
 * tar.gz of a folder's content.
 *
 * @param   {string} dir  - The folder
 * @param   {string} file - The archive
 * @returns {string} sha256
 */
function newTar(dir, file) {

    run('/usr/bin/tar', ['-czf', file, '-C', dir, '.'], { env : Object.assign({}, process.env, { COPYFILE_DISABLE : '1' }) })

    return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')

}

/**
 * The run.
 *
 * @returns {number} Exit code
 */
function main() {

    let workspace  = path.resolve(arg('--workspace', path.resolve(__dirname, '..', '..', 'ducky4')))
    let n          = Number(arg('--n', 0))
    let out        = path.resolve(arg('--out', path.join(os.tmpdir(), 'ducky-bundle-' + n)))
    let dir_api    = path.join(workspace, 'ducky_platform_api')
    let dir_app    = path.join(workspace, 'ducky_platform_app_pro')
    let dir_shared = path.join(workspace, 'ducky_platform_shared')
    let dir_cli    = path.join(workspace, 'ducky_cli')
    let dir_design = path.join(workspace, 'ducky_design')
    let stage      = fs.mkdtempSync(path.join(os.tmpdir(), 'ducky-stage-'))
    let api_build  = null
    let app_build  = null
    let cli_ref    = null
    let design_ref = null
    let shared_ref = null
    let manifest   = null
    let patches    = null
    let lib_cli    = null
    let tag        = 'bundle-' + String(n).padStart(3, '0')

    if (!n) {
        console.log('[err] --n <bundle number> is required (the next after the last published bundle)')
        return 2
    }

    // ducky_cli and ducky_design are read as they are (never fetched into)
    ;[dir_api, dir_app, dir_shared].forEach(function(dir) {

        run('git', ['-C', dir, 'fetch', '--quiet', 'origin'])

    })

    api_build  = arg('--api-build', getLatestBuild(dir_api))
    app_build  = arg('--app-build', getLatestBuild(dir_app))
    shared_ref = run('git', ['-C', dir_shared, 'rev-parse', arg('--shared-ref', 'origin/main')]).trim()
    design_ref = run('git', ['-C', dir_design, 'rev-parse', arg('--design-ref', 'HEAD')]).trim()

    console.log('[info] api ' + api_build + ', app ' + app_build + ', shared ' + shared_ref.slice(0, 7) + ', design ' + design_ref.slice(0, 7))

    // api: the release build + local migrations + the masked base env
    setArchive(dir_api, 'origin/main:build/' + api_build, [], path.join(stage, 'api'))
    if (!fs.existsSync(path.join(stage, 'api', 'scripts', 'local-migrations'))) {
        setArchive(dir_api, 'origin/main:scripts', ['local-migrations'], path.join(stage, 'api', 'scripts'))
    }
    fs.writeFileSync(path.join(stage, 'api', 'env.base.json'), JSON.stringify(setMasked(JSON.parse(fs.readFileSync(path.join(dir_api, 'env.json'), 'utf8')), workspace), null, 4) + '\n')
    setLeakCheck(path.join(stage, 'api', 'env.base.json'))

    // app: the release build + the masked base env
    setArchive(dir_app, 'origin/main:build/' + app_build, [], path.join(stage, 'app'))
    fs.writeFileSync(path.join(stage, 'app', 'env.base.json'), JSON.stringify(setMasked(JSON.parse(fs.readFileSync(path.join(dir_app, 'env.json'), 'utf8')), workspace), null, 4) + '\n')
    setLeakCheck(path.join(stage, 'app', 'env.base.json'))

    // shared: only the env generator and its config
    setArchive(dir_shared, shared_ref, ['scripts/local-envs.js', 'config/apps.json'], path.join(stage, 'shared'))

    // cli: the freeze + the build's patches, marker and css past, no .git
    lib_cli = require(path.join(stage, 'api', 'app', 'services', 'jobs', 'lib_cli_pro'))
    cli_ref = arg('--cli-ref', lib_cli.config.ref)
    run('git', ['clone', '--quiet', '--no-checkout', dir_cli, path.join(stage, 'cli_src')])
    run('git', ['-C', path.join(stage, 'cli_src'), 'checkout', '--quiet', cli_ref])
    patches = path.join(stage, 'api', 'patches', 'ducky_cli')
    fs.readdirSync(patches).filter(function(name) {

        return /\.patch$/.test(name)

    }).sort().forEach(function(name) {

        run('git', ['-C', path.join(stage, 'cli_src'), 'apply', path.join(patches, name)])

    })
    fs.writeFileSync(path.join(stage, 'cli_src', lib_cli.config.marker), JSON.stringify({
        patch_version : lib_cli.getPatchVersion(),
        ref           : cli_ref,
        sha           : run('git', ['-C', path.join(stage, 'cli_src'), 'rev-parse', 'HEAD']).trim()
    }) + '\n')
    lib_cli._past(path.join(stage, 'cli_src'))
    run('/usr/bin/rsync', ['-a', '--exclude', '.git', '--exclude', 'node_modules', '--exclude', '.tmp', '--exclude', '_*', '--exclude', 'local', '--exclude', 'logs', '--exclude', '.development', '--exclude', '.rules', '--exclude', '.claude', '--exclude', 'CLAUDE.md', path.join(stage, 'cli_src') + '/', path.join(stage, 'cli') + '/'])

    setLinksDropped(path.join(stage, 'cli'), path.join(stage, 'cli'))

    // design: only what services.system reads
    setArchive(dir_design, design_ref, ['lib/system-defaults.json', 'themes', 'v4/tokens.css'], path.join(stage, 'design'))

    // the archives + the manifest
    fs.mkdirSync(out, { recursive : true })
    manifest = {
        assets  : {},
        bundle  : tag,
        n       : n,
        sources : {
            api    : run('git', ['-C', dir_api, 'rev-parse', 'origin/main']).trim(),
            app    : run('git', ['-C', dir_app, 'rev-parse', 'origin/main']).trim(),
            cli    : run('git', ['-C', dir_cli, 'rev-parse', cli_ref]).trim(),
            design : design_ref,
            shared : shared_ref
        },
        ts       : new Date().toISOString(),
        versions : {
            api : api_build,
            app : app_build
        }
    }

    ;['api', 'app', 'shared', 'cli', 'design'].forEach(function(name) {

        let file = name + '.tar.gz'

        manifest.assets[name] = {
            file   : file,
            sha256 : newTar(path.join(stage, name), path.join(out, file)),
            size   : fs.statSync(path.join(out, file)).size
        }
        console.log('[ok]   ' + file + ' ' + Math.round(manifest.assets[name].size / 1024 / 1024) + ' MB')

    })
    fs.writeFileSync(path.join(out, 'manifest.json'), JSON.stringify(manifest, null, 4) + '\n')
    fs.rmSync(stage, { force : true, recursive : true })
    console.log('[ok]   ' + tag + ' built in ' + out)

    if (process.argv.indexOf('--publish') === -1) {
        console.log('[info] not published (local dry run); --publish --yes creates the GitHub release (tell the coordinator first)')
        return 0
    }
    if (process.argv.indexOf('--yes') === -1) {
        console.log('[err] --publish needs --yes')
        return 2
    }

    run('gh', ['release', 'create', tag, '--repo', org + '/' + repo, '--title', tag + ' (api ' + api_build + ', app ' + app_build + ')', '--notes', 'release-mode bundle; manifest.json lists the sources and sha256'].concat(['manifest.json', 'api.tar.gz', 'app.tar.gz', 'shared.tar.gz', 'cli.tar.gz', 'design.tar.gz'].map(function(name) {

        return path.join(out, name)

    })))
    console.log('[ok]   published ' + tag + ' on ' + org + '/' + repo)

    return 0

}

// ---

try {
    process.exitCode = main()
} catch (err) {
    console.log('[err]  ' + err.message)
    process.exitCode = 1
}
