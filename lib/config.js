// config.js — the install's paths and <root>/config/*.json.
//
// The install root: --path, else DUCKY_HOME, else the current folder
// (getHomeFound). A second instance (the tests, 0011_10's clean install)
// sets its own root plus `instance` and shifted ports in its ducky.json;
// its launchd labels, nginx file and hosts carry the instance name so it
// never meets the main install.

let crypto = require('crypto')
let fs     = require('fs')
let os     = require('os')
let path   = require('path')

let util = require('./util')

// ---

let defaults = {
    api_database : 'ducky_local_api',
    api_host     : 'api.ducky.localhost',
    api_port     : 4171,
    app_database : 'ducky_local_app',
    app_port     : 4172,
    cloud_api    : 'https://api-pro.duckymonster.com',
    cloud_app    : 'https://pro.duckymonster.com',
    github_org   : 'Ducky-Monster-Limited',
    host         : 'ducky.localhost',
    instance     : '',
    keys         : 'pull',
    mongo_url    : 'mongodb://127.0.0.1:27017/ducky_local_api',
    path_roots   : ['~', '/Volumes'],
    redis_db     : 4
}

// the repos of an install, cloned as siblings (their relative symlinks
// resolve); ducky_secrets is read by the shared scripts/secrets.js
let repos = [
    { name : 'ducky_platform_api',     remote : 'ducky-platform-api' },
    { name : 'ducky_platform_app_pro', remote : 'ducky-platform-pro' },
    { name : 'ducky_platform_shared',  remote : 'ducky-platform-shared' },
    { name : 'ducky_platform_app',     remote : 'ducky-platform-app' },
    { name : 'ducky_cli',              remote : 'ducky-cli' },
    { name : 'ducky_design',           remote : 'ducky-design' },
    { name : 'ducky_secrets',          remote : 'ducky-secrets' }
]

// the install root of this run (setHome), and the file in the installer
// repo that remembers the last install for runs outside its folder
let home_current = null
let home_file    = path.join(util.dir_root, '.ducky_home')

/**
 * Expands a leading ~ to the home directory.
 *
 * @param   {string} value - A path
 * @returns {string} The expanded path
 */
function getExpanded(value) {

    if (value === '~') return os.homedir()
    if (value.indexOf('~/') === 0) return path.join(os.homedir(), value.slice(2))

    return value

}

/**
 * The install root: the one set for this run, else DUCKY_HOME, else the
 * current folder.
 *
 * @returns {string} Absolute path
 */
function getHome() {

    return home_current || path.resolve(process.env.DUCKY_HOME || process.cwd())

}

/**
 * Finds the install root of a run: --path, else DUCKY_HOME; install then
 * takes the current folder, every other command the nearest folder up
 * holding config/ducky.json, else the remembered install.
 *
 * @param   {(string|null)} value   - The --path value
 * @param   {boolean}       install - True for `ducky-pro install`
 * @returns {(string|null)} Absolute path, null when no install is found
 */
function getHomeFound(value, install) {

    let dir    = process.cwd()
    let parent = null
    let stored = null

    if (value) return path.resolve(getExpanded(value))
    if (process.env.DUCKY_HOME) return path.resolve(getExpanded(process.env.DUCKY_HOME))
    if (install) return dir

    while (dir) {

        if (fs.existsSync(path.join(dir, 'config', 'ducky.json'))) return dir

        parent = path.dirname(dir)
        dir    = parent !== dir ? parent : null

    }

    try {
        stored = fs.readFileSync(home_file, 'utf8').trim()
    } catch (e) {
        stored = null
    }

    return stored && fs.existsSync(path.join(stored, 'config', 'ducky.json')) ? stored : null

}

/**
 * Sets the install root of this run.
 *
 * @param   {string} dir - Absolute path
 * @returns {string} The root
 */
function setHome(dir) {

    home_current = path.resolve(dir)

    return home_current

}

/**
 * Remembers the install root for runs outside its folder.
 *
 * @param   {string}  dir - Absolute path
 * @returns {boolean} True when written
 */
function setHomeRemembered(dir) {

    return util.setFile(home_file, dir + '\n', 0o600)

}

/**
 * Every path of the install.
 *
 * @param   {object} settings - ducky.json (for the instance name)
 * @returns {object} The paths
 */
function getPaths(settings) {

    let home     = getHome()
    let instance = settings && settings.instance ? settings.instance : ''
    let suffix   = instance ? '.' + instance : ''
    let brew     = fs.existsSync('/opt/homebrew') ? '/opt/homebrew' : '/usr/local'

    return {
        agents        : process.env.DUCKY_LAUNCH_AGENTS || path.join(os.homedir(), 'Library', 'LaunchAgents'),
        brew          : brew,
        certs         : path.join(home, 'certs'),
        config        : path.join(home, 'config'),
        ducky_json    : path.join(home, 'config', 'ducky.json'),
        home          : home,
        label         : 'com.duckymonster.ducky' + suffix,
        logs          : path.join(home, 'logs'),
        media         : path.join(home, 'media'),
        migrations    : path.join(home, 'config', 'migrations.json'),
        models        : path.join(home, 'models', 'whisper'),
        nginx_file    : path.join(process.env.DUCKY_NGINX_SERVERS || path.join(brew, 'etc', 'nginx', 'servers'), 'ducky_local' + (instance ? '_' + instance : '') + '.conf'),
        repos         : path.join(home, 'repos'),
        run           : path.join(home, 'run'),
        secrets_json  : path.join(home, 'config', 'secrets.json')
    }

}

/**
 * Reads a json file, null when missing.
 *
 * @param   {string} file - Absolute path
 * @returns {(object|null)} The content
 */
function getJSON(file) {

    try {
        return JSON.parse(fs.readFileSync(file, 'utf8'))
    } catch (e) {
        return null
    }

}

/**
 * ducky.json over the defaults.
 *
 * @returns {object} The settings
 */
function getSettings() {

    let stored = getJSON(path.join(getHome(), 'config', 'ducky.json')) || {}
    let merged = Object.assign({}, defaults, stored)

    // IMPORTANT
    // one install since plan_0013: the old dev/release mode keys of an
    // existing ducky.json are dropped

    delete merged.mode
    delete merged.release

    return merged

}

/**
 * Writes ducky.json (0600), only when it changed.
 *
 * @param   {object}  settings - The settings
 * @returns {boolean} True when written
 */
function setSettings(settings) {

    return util.setFile(path.join(getHome(), 'config', 'ducky.json'), JSON.stringify(settings, null, 4) + '\n', 0o600)

}

/**
 * Mints a client key in the platform's grouped-syllable shape (as
 * new-app.js does).
 *
 * @returns {string} The key
 */
function newClientKey() {

    let alphabet = 'abcdefghijklmnopqrstuvwxyz'
    let bytes    = crypto.randomBytes(24)
    let groups   = []
    let i        = 0
    let j        = 0

    for (i = 0; i < 6; i++) {

        let group = ''

        for (j = 0; j < 4; j++) {
            group += alphabet[bytes[i * 4 + j] % alphabet.length]
        }

        groups.push(group)

    }

    return groups.join('-')

}

/**
 * Mints an alphanumeric secret.
 *
 * @param   {number} size - Characters
 * @returns {string} The secret
 */
function newSecret(size) {

    let alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
    let bytes    = crypto.randomBytes(size)
    let out      = ''
    let i        = 0

    for (i = 0; i < size; i++) {
        out += alphabet[bytes[i] % alphabet.length]
    }

    return out

}

/**
 * The install's secrets: minted once, kept forever (re-runs keep them).
 *
 * @param   {object} current - The stored secrets (or null)
 * @returns {object} The secrets, missing keys filled
 */
function newSecrets(current) {

    let secrets = Object.assign({}, current || {})

    if (!secrets.client_key) secrets.client_key = newClientKey()
    if (!secrets.client_secret) secrets.client_secret = newSecret(40)
    if (!secrets.session_auth_secret) secrets.session_auth_secret = newSecret(48)
    if (!secrets.session_invite_secret) secrets.session_invite_secret = newSecret(48)
    if (!secrets.session_secret) secrets.session_secret = newSecret(48)
    if (!secrets.session_sign_secret) secrets.session_sign_secret = newSecret(48)
    if (!secrets.system_secret_key) secrets.system_secret_key = crypto.randomBytes(32).toString('hex')

    return secrets

}

module.exports = {
    defaults,
    getHome,
    getHomeFound,
    getJSON,
    getPaths,
    getSettings,
    newSecrets,
    repos,
    setHome,
    setHomeRemembered,
    setSettings
}
