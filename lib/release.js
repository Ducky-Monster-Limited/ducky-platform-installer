// release.js — which pro release an install runs and how `ducky-pro
// update` reaches one. An install follows the pro releases, not main:
//
//   - a release is a GitHub release (and its tag) on ducky-platform-pro,
//     X.Y.Z-pro-rcN; the latest is the GitHub release marked Latest (gh),
//     else the highest such tag on the app_pro remote
//   - app_pro: the release's tag
//   - api: the build commit on main whose subject is the version
//     ("0.0.1-pro-rcN: …", release_workspace.sh commits "$VERSION")
//   - cli: the ref the api's lib_cli_pro config.ref names at that commit
//   - shared, app, design: no release marker of their own; their last
//     commit on main when the release was cut (the later of the api's and
//     the app_pro's build commit; the release script pushes shared first)
//   - ducky_secrets: main (the team's secrets, not code)
//
// `update --main` pulls main deliberately. What an install runs is kept
// in config/release.json ({ mode, refs, ts, version, installer, node }),
// which the local api reads for the header's "update rcN available".

let fs   = require('fs')
let path = require('path')

let config = require('./config')
let util   = require('./util')

// ---

let pattern = /^(\d+)\.(\d+)\.(\d+)-pro-rc(\d+)$/

// how each repo of an install finds its commit for a release
let rules = {
    ducky_cli              : 'cli',
    ducky_design           : 'time',
    ducky_platform_api     : 'build',
    ducky_platform_app     : 'time',
    ducky_platform_app_pro : 'tag',
    ducky_platform_shared  : 'time',
    ducky_secrets          : 'main'
}

let git_env = {
    GIT_SSH_COMMAND     : 'ssh -o BatchMode=yes -o StrictHostKeyChecking=accept-new',
    GIT_TERMINAL_PROMPT : '0'
}

/**
 * Runs git in a repo, never asking for a password.
 *
 * @param   {string} dir     - The repo
 * @param   {array}  args    - git arguments
 * @param   {number} timeout - Milliseconds (default 2 min)
 * @returns {object} exec result
 */
function git(dir, args, timeout) {

    return util.exec('git', ['-C', dir].concat(args), {
        env     : git_env,
        timeout : timeout || 2 * 60 * 1000
    })

}

/**
 * The numbers of a pro release version.
 *
 * @param   {string} version - X.Y.Z-pro-rcN
 * @returns {(array|null)} [X, Y, Z, N], null when it is none
 */
function getParts(version) {

    let found = pattern.exec(String(version || ''))

    return found ? found.slice(1).map(Number) : null

}

/**
 * Whether one release is newer than another (anything is newer than
 * none).
 *
 * @param   {string}  version - The candidate
 * @param   {string}  than    - The current one (or null)
 * @returns {boolean} True when newer
 */
function getNewer(version, than) {

    let a     = getParts(version)
    let b     = getParts(than)
    let index = 0

    if (!a) return false
    if (!b) return true

    for (index = 0; index < a.length; index++) {

        if (a[index] !== b[index]) return a[index] > b[index]

    }

    return false

}

/**
 * The short name of a release (rcN), the version itself otherwise.
 *
 * @param   {string} version - X.Y.Z-pro-rcN
 * @returns {string} rcN
 */
function getLabel(version) {

    let parts = getParts(version)

    return parts ? 'rc' + parts[3] : String(version || '')

}

/**
 * The highest pro release among tag names.
 *
 * @param   {array}  names - Tag names
 * @returns {(string|null)} The version
 */
function getHighest(names) {

    let best = null

    names.forEach(function(name) {

        if (getParts(name) && getNewer(name, best)) best = name

    })

    return best

}

/**
 * The latest pro release: the GitHub release marked Latest (gh, signed
 * in), else the highest pro tag on the app_pro remote. A `clone_base`
 * install (tests) reads its local remote's tags only.
 *
 * @param   {object} ctx - The run context
 * @returns {(object|null)} { source, version }, null when unknown
 */
function getLatest(ctx) {

    let item   = getRepo('ducky_platform_app_pro')
    let gh     = ctx.settings.clone_base ? null : util.getWhich('gh')
    let result = null
    let names  = []

    if (gh) {

        result = util.exec(gh, ['api', 'repos/' + ctx.settings.github_org + '/' + item.remote + '/releases/latest', '--jq', '.tag_name'], { timeout : 20 * 1000 })

        if (result.code === 0 && getParts(result.out.trim())) return {
            source  : 'github release',
            version : result.out.trim()
        }

    }

    result = git(path.join(ctx.paths.repos, item.name), ['ls-remote', '--tags', '--refs', 'origin'], 30 * 1000)

    if (result.code !== 0) return null

    names = result.out.split('\n').map(function(line) {

        return line.split('refs/tags/')[1] || ''

    })

    return getHighest(names) ? { source : 'tags', version : getHighest(names) } : null

}

/**
 * One repo entry of the install by name.
 *
 * @param   {string} name - The folder name
 * @returns {object} { name, remote }
 */
function getRepo(name) {

    return config.repos.filter(function(item) {

        return item.name === name

    })[0]

}

/**
 * The install's release record (config/release.json), null when the
 * install never ran a release update.
 *
 * @param   {object} paths - config.getPaths()
 * @returns {(object|null)} The record
 */
function getRecord(paths) {

    return config.getJSON(path.join(paths.config, 'release.json'))

}

/**
 * The commit a repo's HEAD is on.
 *
 * @param   {string} dir - The repo
 * @returns {(string|null)} The sha
 */
function getHead(dir) {

    let result = git(dir, ['rev-parse', 'HEAD'])

    return result.code === 0 ? result.out.trim() : null

}

/**
 * The commit a ref names in a repo (tags peeled).
 *
 * @param   {string} dir - The repo
 * @param   {string} ref - A tag, branch or sha
 * @returns {(string|null)} The sha
 */
function getSha(dir, ref) {

    let result = git(dir, ['rev-parse', '--verify', '--quiet', ref + '^{commit}'])

    return result.code === 0 ? result.out.trim() : null

}

/**
 * The api's build commit of a release on main: the newest commit whose
 * subject is the version, alone or followed by a colon.
 *
 * @param   {string} dir     - The api repo
 * @param   {string} version - X.Y.Z-pro-rcN
 * @returns {(string|null)} The sha
 */
function getBuildCommit(dir, version) {

    let result = git(dir, ['log', 'origin/main', '--fixed-strings', '--grep=' + version, '--format=%H%x09%s'])
    let found  = null

    if (result.code !== 0) return null

    result.out.split('\n').some(function(line) {

        let parts   = line.split('\t')
        let subject = parts.slice(1).join('\t')

        if (subject === version || subject.indexOf(version + ':') === 0) found = parts[0]

        return !!found

    })

    return found

}

/**
 * The cli ref the api's pro copy uses at a commit (lib_cli_pro's
 * config.ref).
 *
 * @param   {string} dir - The api repo
 * @param   {string} sha - The api commit
 * @returns {(string|null)} The ref
 */
function getCliRef(dir, sha) {

    let result = git(dir, ['show', sha + ':app/services/jobs/lib_cli_pro.js'])
    let found  = result.code === 0 ? /\bref\s*:\s*'([^']+)'/.exec(result.out) : null

    return found ? found[1] : null

}

/**
 * The committer time of a commit.
 *
 * @param   {string} dir - The repo
 * @param   {string} sha - The commit
 * @returns {number} Unix seconds (0 when unknown)
 */
function getTime(dir, sha) {

    let result = git(dir, ['log', '-1', '--format=%ct', sha])

    return result.code === 0 ? Number(result.out.trim()) || 0 : 0

}

/**
 * The last commit on main at a time (first parents only).
 *
 * @param   {string} dir  - The repo
 * @param   {number} time - Unix seconds
 * @returns {(string|null)} The sha
 */
function getAtTime(dir, time) {

    let result = git(dir, ['rev-list', '-1', '--first-parent', '--before=' + new Date(time * 1000).toISOString(), 'origin/main'])

    return result.code === 0 && result.out.trim() ? result.out.trim() : null

}

/**
 * Fetches every repo of the install (tags too, pruned).
 *
 * @param   {object} ctx - The run context
 * @returns {array} The repos whose fetch failed
 */
function fetch(ctx) {

    return config.repos.filter(function(item) {

        return git(path.join(ctx.paths.repos, item.name), ['fetch', '--quiet', '--tags', '--prune', '--force', 'origin'], 10 * 60 * 1000).code !== 0

    }).map(function(item) {

        return item.name

    })

}

/**
 * The commits of one release for every repo (after fetch). Missing ones
 * are listed: the release is not consistent then and nothing moves.
 *
 * @param   {object} ctx     - The run context
 * @param   {string} version - X.Y.Z-pro-rcN
 * @returns {object} { missing, mode, refs, version }
 */
function getTarget(ctx, version) {

    let dir     = function(name) {

        return path.join(ctx.paths.repos, name)

    }
    let refs    = {}
    let missing = []
    let api     = getBuildCommit(dir('ducky_platform_api'), version)
    let pro     = getSha(dir('ducky_platform_app_pro'), 'refs/tags/' + version)
    let cli     = api ? getCliRef(dir('ducky_platform_api'), api) : null
    let time    = Math.max(api ? getTime(dir('ducky_platform_api'), api) : 0, pro ? getTime(dir('ducky_platform_app_pro'), pro) : 0)

    config.repos.forEach(function(item) {

        let rule = rules[item.name] || 'main'
        let sha  = null

        if (rule === 'build') sha = api
        if (rule === 'tag') sha = pro
        if (rule === 'cli') sha = cli ? getSha(dir(item.name), cli) : null
        if (rule === 'time') sha = time ? getAtTime(dir(item.name), time) : null
        if (rule === 'main') sha = getSha(dir(item.name), 'origin/main')

        refs[item.name] = sha
        if (!sha) missing.push(item.name + ' (' + (rule === 'build' ? 'no build commit "' + version + '" on main' : rule === 'tag' ? 'no tag ' + version : rule === 'cli' ? 'cli ref ' + (cli || 'unknown') + ' not found' : 'no commit on main') + ')')

    })

    return {
        missing : missing,
        mode    : 'release',
        refs    : refs,
        version : version
    }

}

/**
 * Main for every repo (after fetch): `update --main`.
 *
 * @param   {object} ctx - The run context
 * @returns {object} { missing, mode, refs, version }
 */
function getTargetMain(ctx) {

    let refs    = {}
    let missing = []

    config.repos.forEach(function(item) {

        refs[item.name] = getSha(path.join(ctx.paths.repos, item.name), 'origin/main')
        if (!refs[item.name]) missing.push(item.name + ' (no origin/main)')

    })

    return {
        missing : missing,
        mode    : 'main',
        refs    : refs,
        version : null
    }

}

/**
 * The repos whose HEAD is not where the target puts it.
 *
 * @param   {object} ctx    - The run context
 * @param   {object} target - getTarget / getTargetMain
 * @returns {array} [{ from, name, to }]
 */
function getMoves(ctx, target) {

    return config.repos.map(function(item) {

        return {
            from : getHead(path.join(ctx.paths.repos, item.name)),
            name : item.name,
            to   : target.refs[item.name]
        }

    }).filter(function(move) {

        return move.from !== move.to

    })

}

/**
 * Puts one repo on a commit: on main (fast-forward) for main and the
 * secrets, detached at the commit for a release.
 *
 * @param   {string}  dir    - The repo
 * @param   {string}  sha    - The commit
 * @param   {boolean} branch - True: main, fast-forwarded to the commit
 * @returns {boolean} True when the HEAD is there
 */
function setHead(dir, sha, branch) {

    if (!branch) return git(dir, ['checkout', '--quiet', '--detach', sha]).code === 0 && getHead(dir) === sha

    if (git(dir, ['checkout', '--quiet', 'main']).code !== 0 && git(dir, ['checkout', '--quiet', '-b', 'main', sha]).code !== 0) return false
    if (git(dir, ['merge', '--quiet', '--ff-only', sha]).code !== 0) return false

    return getHead(dir) === sha

}

/**
 * Moves every repo to the target; puts them all back where they were when
 * one fails, so an install never runs half a release.
 *
 * @param   {object} ctx    - The run context
 * @param   {object} target - getTarget / getTargetMain
 * @returns {object} { failed, moved }
 */
function checkout(ctx, target) {

    let before   = {}
    let branches = {}
    let moved    = []
    let failed   = null

    config.repos.forEach(function(item) {

        let dir = path.join(ctx.paths.repos, item.name)

        before[item.name]   = getHead(dir)
        branches[item.name] = git(dir, ['symbolic-ref', '-q', '--short', 'HEAD']).out.trim()

    })

    config.repos.some(function(item) {

        let dir    = path.join(ctx.paths.repos, item.name)
        let branch = target.mode === 'main' || rules[item.name] === 'main'

        if (getHead(dir) === target.refs[item.name] && (!branch || git(dir, ['symbolic-ref', '-q', 'HEAD']).code === 0)) return false

        if (!setHead(dir, target.refs[item.name], branch)) {
            failed = item.name
            return true
        }

        moved.push(item.name)

        return false

    })

    if (failed) {

        // a repo that was on a branch gets that branch back where it was
        moved.concat([failed]).forEach(function(name) {

            git(path.join(ctx.paths.repos, name), branches[name] ? ['checkout', '--quiet', '-B', branches[name], before[name]] : ['checkout', '--quiet', '--detach', before[name]])

        })

    }

    return {
        failed : failed,
        moved  : failed ? [] : moved
    }

}

/**
 * Keeps what the install runs now (config/release.json, 0600), with the
 * command the local api opens for a one-click update.
 *
 * @param   {object}  ctx    - The run context
 * @param   {object}  target - getTarget / getTargetMain
 * @returns {boolean} True when written
 */
function setRecord(ctx, target) {

    let record = {
        installer : path.join(util.dir_root, 'bin', 'ducky-pro'),
        mode      : target.mode,
        node      : ctx.settings.node || process.execPath,
        refs      : target.refs,
        ts        : new Date().toISOString(),
        version   : target.version
    }

    return util.setFile(path.join(ctx.paths.config, 'release.json'), JSON.stringify(record, null, 4) + '\n', 0o600)

}

module.exports = {
    checkout,
    fetch,
    getHead,
    getHighest,
    getLabel,
    getLatest,
    getMoves,
    getNewer,
    getParts,
    getRecord,
    getTarget,
    getTargetMain,
    rules,
    setRecord
}
