// sources.js — where the platform code comes from.
//
// dev mode (Marc's machines, `--dev`): git clones of the repos (sibling
// folders, so their relative symlinks resolve), `ducky update` pulls.
//
// release mode (everyone else, the default): no clone. Versioned bundles
// (release assets of the installer repo, one GitHub release per bundle,
// tag bundle-<n>) unpacked under the same folder names. The person's
// read-only token (config/release_token, 0600) is the only credential;
// `ducky update` moves to the next bundle only.

let crypto = require('crypto')
let fs     = require('fs')
let os     = require('os')
let path   = require('path')

let config = require('./config')
let util   = require('./util')

// ---

/**
 * The token of this install (release mode), '' when none.
 *
 * @param   {object} paths - config.getPaths()
 * @returns {string} The token
 */
function getToken(paths) {

    try {
        return fs.readFileSync(paths.release_token, 'utf8').trim()
    } catch (e) {
        return ''
    }

}

/**
 * Calls curl with the token in a 0600 header file (never on the command
 * line, never printed).
 *
 * @param   {object} paths - config.getPaths()
 * @param   {array}  args  - curl arguments (url last)
 * @param   {string} accept - Accept header
 * @returns {object} exec result
 */
function curl(paths, args, accept) {

    let dir    = fs.mkdtempSync(path.join(os.tmpdir(), 'ducky-h-'))
    let file   = path.join(dir, 'headers')
    let result = null

    fs.writeFileSync(file, 'Authorization: Bearer ' + getToken(paths) + '\nAccept: ' + accept + '\nX-GitHub-Api-Version: 2022-11-28\n', { mode : 0o600 })

    try {
        result = util.exec('/usr/bin/curl', ['-fsSL', '--retry', '3', '-H', '@' + file].concat(args), { timeout : 30 * 60 * 1000 })
    } finally {
        fs.rmSync(dir, { force : true, recursive : true })
    }

    return result

}

/**
 * The bundles published on the installer repo, oldest first.
 *
 * @param   {object} settings - ducky.json
 * @param   {object} paths    - config.getPaths()
 * @returns {object} { bundles, err }
 */
function getBundles(settings, paths) {

    let url    = 'https://api.github.com/repos/' + settings.github_org + '/' + settings.release.repo + '/releases?per_page=100'
    let result = null
    let list   = null

    if (settings.release.local_dir) return getLocalBundles(settings.release.local_dir)
    if (!getToken(paths)) return { bundles : [], err : 'no release token (config/release_token)' }

    result = curl(paths, [url], 'application/vnd.github+json')

    if (result.code !== 0) return { bundles : [], err : 'the release list did not load (token revoked or expired?)' }

    try {
        list = JSON.parse(result.out)
    } catch (e) {
        return { bundles : [], err : 'the release list is not json' }
    }

    return {
        bundles : list.filter(function(release) {

            return /^bundle-\d+$/.test(release.tag_name) && !release.draft

        }).map(function(release) {

            return {
                assets : release.assets,
                n      : Number(release.tag_name.slice(7)),
                tag    : release.tag_name
            }

        }).sort(function(a, b) {

            return a.n - b.n

        }),
        err     : null
    }

}

/**
 * Bundles from a local folder (bundle-<n>/ with manifest.json + the
 * archives): offline installs and the tests. No token needed.
 *
 * @param   {string} dir - The folder
 * @returns {object} { bundles, err }
 */
function getLocalBundles(dir) {

    let names = []

    try {
        names = fs.readdirSync(dir)
    } catch (e) {
        return { bundles : [], err : 'no bundle folder ' + dir }
    }

    return {
        bundles : names.filter(function(name) {

            return /^bundle-\d+$/.test(name) && fs.existsSync(path.join(dir, name, 'manifest.json'))

        }).map(function(name) {

            return {
                assets : fs.readdirSync(path.join(dir, name)).map(function(file) {

                    return { name : file, path : path.join(dir, name, file) }

                }),
                n      : Number(name.slice(7)),
                tag    : name
            }

        }).sort(function(a, b) {

            return a.n - b.n

        }),
        err     : null
    }

}

/**
 * The bundle to install: the latest on a first install, the next one
 * after the current on an update.
 *
 * @param   {array}  bundles - getBundles().bundles
 * @param   {string} current - The installed tag (or null)
 * @returns {(object|null)} The bundle
 */
function getNext(bundles, current) {

    let n = current ? Number(String(current).replace(/^bundle-/, '')) : null

    if (!bundles.length) return null
    if (n === null) return bundles[bundles.length - 1]

    return bundles.filter(function(bundle) {

        return bundle.n > n

    })[0] || null

}

/**
 * Downloads one asset of a bundle.
 *
 * @param   {object} paths  - config.getPaths()
 * @param   {object} bundle - From getBundles()
 * @param   {string} name   - The asset file name
 * @param   {string} file   - Where to save it
 * @returns {boolean} True when saved
 */
function download(paths, bundle, name, file) {

    let asset = bundle.assets.filter(function(item) {

        return item.name === name

    })[0]

    if (!asset) return false

    if (asset.path) {
        fs.copyFileSync(asset.path, file)
        return true
    }

    return curl(paths, ['-o', file, asset.url], 'application/octet-stream').code === 0

}

/**
 * The sha256 of a file.
 *
 * @param   {string} file - Absolute path
 * @returns {string} Hex digest
 */
function getSha(file) {

    return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')

}

/**
 * Unpacks a bundle's archives into the repos folder. The previous
 * version of each folder moves to repos/.previous (one step back), the
 * generated envs and node_modules are carried over.
 *
 * @param   {object} paths    - config.getPaths()
 * @param   {string} dir      - Folder holding manifest.json + the archives
 * @returns {object} { err, manifest }
 */
function unpack(paths, dir) {

    let manifest = config.getJSON(path.join(dir, 'manifest.json'))
    let bad      = null

    if (!manifest || !manifest.assets) return { err : 'the bundle has no manifest', manifest : null }

    bad = config.repos.release.filter(function(item) {

        let entry = manifest.assets[item.asset]

        return !entry || !fs.existsSync(path.join(dir, entry.file)) || getSha(path.join(dir, entry.file)) !== entry.sha256

    })[0]

    if (bad) return { err : 'the ' + bad.asset + ' archive is missing or its sha256 does not match the manifest', manifest : null }

    fs.mkdirSync(path.join(paths.repos, '.previous'), { recursive : true })

    config.repos.release.forEach(function(item) {

        let target = path.join(paths.repos, item.name)
        let next   = target + '.next'
        let prev   = path.join(paths.repos, '.previous', item.name)

        fs.rmSync(next, { force : true, recursive : true })
        fs.mkdirSync(next, { recursive : true })
        util.exec('/usr/bin/tar', ['-xzf', path.join(dir, manifest.assets[item.asset].file), '-C', next])

        if (fs.existsSync(target)) {

            ;['env.local.api.json', 'env.local.app.json', 'node_modules'].forEach(function(keep) {

                if (fs.existsSync(path.join(target, keep)) && !fs.existsSync(path.join(next, keep))) fs.renameSync(path.join(target, keep), path.join(next, keep))

            })
            fs.rmSync(prev, { force : true, recursive : true })
            fs.renameSync(target, prev)

        }

        fs.renameSync(next, target)

    })

    return { err : null, manifest : manifest }

}

/**
 * Dev mode: the repos that are not cloned yet.
 *
 * @param   {object} paths - config.getPaths()
 * @returns {array} Repo entries
 */
function getMissingClones(paths) {

    return config.repos.dev.filter(function(item) {

        return !fs.existsSync(path.join(paths.repos, item.name, '.git'))

    })

}

/**
 * Dev mode: clones one repo (from GitHub, or from `clone_base`, a local
 * folder holding the repos under the same names: tests).
 *
 * @param   {object} settings - ducky.json
 * @param   {object} paths    - config.getPaths()
 * @param   {object} item     - Repo entry
 * @returns {object} exec result
 */
function clone(settings, paths, item) {

    let source = settings.clone_base
        ? path.join(settings.clone_base, item.name)
        : 'https://github.com/' + settings.github_org + '/' + item.remote + '.git'

    fs.mkdirSync(paths.repos, { recursive : true })

    return util.exec('git', ['clone', '--quiet', source, path.join(paths.repos, item.name)], { timeout : 30 * 60 * 1000 })

}

module.exports = {
    clone,
    download,
    getBundles,
    getMissingClones,
    getNext,
    getSha,
    getToken,
    unpack
}
