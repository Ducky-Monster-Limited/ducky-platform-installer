// 05_sources.js — the platform code: dev mode clones the repos, release
// mode downloads and unpacks the latest bundle with the person's token.

let fs   = require('fs')
let path = require('path')

let config  = require('../config')
let sources = require('../sources')
let util    = require('../util')

// ---

/**
 * Release mode: stores the token (0600) when it is not stored yet.
 *
 * @param   {object} ctx - The run context
 * @returns {Promise<boolean>} True when a token is stored
 */
async function setToken(ctx) {

    let token = ''

    if (sources.getToken(ctx.paths)) return true

    if (ctx.token_file) {
        token = fs.readFileSync(ctx.token_file, 'utf8').trim()
    } else {
        token = await util.askLine('the release token you were given (input hidden):', true)
    }

    if (!token) return false

    util.setFile(ctx.paths.release_token, token + '\n', 0o600)

    return true

}

/**
 * Release mode: downloads and unpacks a bundle.
 *
 * @param   {object} ctx    - The run context
 * @param   {object} bundle - From sources.getBundles()
 * @returns {object} { detail, ok }
 */
function setBundle(ctx, bundle) {

    let dir      = path.join(ctx.paths.run, bundle.tag)
    let manifest = null
    let result   = null
    let failed   = null

    fs.rmSync(dir, { force : true, recursive : true })
    fs.mkdirSync(dir, { recursive : true })

    if (!sources.download(ctx.paths, bundle, 'manifest.json', path.join(dir, 'manifest.json'))) return { detail : bundle.tag + ' has no manifest.json', ok : false }

    manifest = config.getJSON(path.join(dir, 'manifest.json'))
    failed = Object.keys(manifest.assets || {}).filter(function(key) {

        return !sources.download(ctx.paths, bundle, manifest.assets[key].file, path.join(dir, manifest.assets[key].file))

    })[0]

    if (failed) return { detail : 'the ' + failed + ' archive of ' + bundle.tag + ' did not download', ok : false }

    result = sources.unpack(ctx.paths, dir)
    fs.rmSync(dir, { force : true, recursive : true })

    if (result.err) return { detail : result.err, ok : false }

    ctx.settings.release.current = bundle.tag
    ctx.settings.release.versions = result.manifest.versions || null
    config.setSettings(ctx.settings)

    return { detail : bundle.tag + ' unpacked', ok : true }

}

module.exports = {
    setBundle,
    key   : 'sources',
    sudo  : false,
    title : 'the platform code (dev: git clones; release: the latest bundle)',
    apply : async function(ctx) {

        let failed = []
        let list   = null
        let bundle = null

        if (ctx.settings.mode === 'dev') {

            sources.getMissingClones(ctx.paths).forEach(function(item) {

                if (sources.clone(ctx.settings, ctx.paths, item).code !== 0) failed.push(item.name)

            })

            return failed.length ? { detail : 'clone failed: ' + failed.join(', '), ok : false } : { detail : 'cloned', ok : true }

        }

        if (!ctx.settings.release.local_dir && !(await setToken(ctx))) return { detail : 'no release token given', ok : false }

        list = sources.getBundles(ctx.settings, ctx.paths)

        if (list.err) return { detail : list.err, ok : false }

        bundle = sources.getNext(list.bundles, null)

        if (!bundle) return { detail : 'no bundle published yet', ok : false }

        return setBundle(ctx, bundle)

    },
    check : function(ctx) {

        let missing = []

        if (ctx.settings.mode === 'dev') {

            missing = sources.getMissingClones(ctx.paths)

            return missing.length ? { detail : 'git clone ' + missing.map(function(item) { return item.name }).join(', '), ok : false } : { detail : 'dev clones present', ok : true }

        }

        missing = config.repos.release.filter(function(item) {

            return !fs.existsSync(path.join(ctx.paths.repos, item.name))

        })

        if (!ctx.settings.release.current || missing.length) return { detail : 'download + unpack the latest bundle (needs the release token)', ok : false }

        return { detail : ctx.settings.release.current, ok : true }

    }
}
