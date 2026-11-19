// commands.js — the `ducky` command's verbs: install, start, stop, status,
// update, doctor, logs, link.

let fs   = require('fs')
let os   = require('os')
let path = require('path')

let agents   = require('./agents')
let checks   = require('./checks')
let config   = require('./config')
let nginx    = require('./nginx')
let steps    = require('./steps')
let packages = require('./steps/03_packages')
let util     = require('./util')

// ---

/**
 * Runs the install steps: check, show the plan, ask, apply, check again.
 * Sudo steps always ask; with --no-sudo (or no terminal) they are listed
 * for a person to run.
 *
 * @param   {object} ctx - The run context
 * @returns {Promise<number>} Exit code
 */
async function install(ctx) {

    let applied = 0
    let pending = []
    let index   = 0

    util.say('info', 'install ' + ctx.paths.home + (ctx.dry ? ' (dry run)' : ''))

    if (!ctx.dry) config.setHomeRemembered(ctx.paths.home)

    for (index = 0; index < steps.length; index++) {

        let step   = steps[index]
        let sudo   = typeof step.sudo === 'function' ? step.sudo(ctx) : step.sudo
        let result = null
        let yes    = false

        if (ctx.skip.indexOf(step.key) !== -1 || (ctx.only.length && ctx.only.indexOf(step.key) === -1)) {
            util.say('skip', step.key)
            continue
        }

        result = step.check(ctx)

        if (result.ok) {
            util.say('ok', step.key + ': ' + result.detail)
            continue
        }
        if (result.fatal) {
            util.say('err', step.key + ': ' + result.detail)
            return 1
        }

        util.say('plan', step.key + (sudo ? ' (sudo)' : '') + ': ' + step.title + ' -> ' + result.detail)

        if (ctx.dry) {
            util.say('dry', 'not applied')
            if (sudo) pending.push(step.key + ': ' + result.detail)
            continue
        }
        if (sudo && (ctx.no_sudo || !process.stdin.isTTY)) {
            util.say('sudo', 'left for a person: ' + result.detail)
            pending.push(step.key + ': ' + result.detail)
            continue
        }

        yes = sudo || !ctx.yes ? await util.ask('       apply ' + step.key + '?') : true

        if (!yes) {
            util.say('skip', step.key + ' (declined)')
            if (sudo) pending.push(step.key + ': ' + result.detail)
            continue
        }

        result = await step.apply(ctx)
        applied++

        if (!result.ok || !step.check(ctx).ok) {
            util.say('err', step.key + ': ' + result.detail)
            return 1
        }

        util.say('ok', step.key + ': ' + result.detail)

    }

    util.say('info', applied + ' step(s) applied')

    pending.forEach(function(line) {

        util.say('sudo', 'pending: ' + line)

    })

    return 0

}

/**
 * The pid of the api agent's process and whether it has children (a cli
 * job runs).
 *
 * @param   {object} ctx - The run context
 * @returns {boolean} True when a job runs
 */
function getJobRunning(ctx) {

    let api = agents.getAgents(ctx.settings, ctx.paths).filter(function(agent) {

        return agent.side === 'api'

    })[0]
    let state = agents.getState(api.label)

    if (!state.pid) return false

    return util.exec('/usr/bin/pgrep', ['-P', String(state.pid)]).code === 0

}

/**
 * Starts the stack: blocking checks, redis/nginx when stopped (never
 * mongod unless the installer installed it), the two agents, health,
 * the boot pull (one status line, never blocking), the browser.
 *
 * @param   {object} ctx - The run context
 * @returns {Promise<number>} Exit code
 */
async function start(ctx) {

    let list  = agents.getAgents(ctx.settings, ctx.paths)
    let tries = 0
    let up    = false

    if (!(await checks.getPort(27017))) {

        if (!ctx.settings.mongod_installed) {
            util.say('err', 'mongod is not running; it is not ours, start it the way it was installed')
            return 1
        }

        util.exec('brew', ['services', 'start', 'mongodb/brew/mongodb-community'])

    }
    if (!(await checks.getPort(6379))) util.exec('brew', ['services', 'start', 'redis'])
    if (!nginx.getMaster()) {

        util.say('info', 'nginx is not running: starting it needs sudo')

        if (!(await util.ask('       sudo nginx?'))) return 1

        util.exec('/usr/bin/sudo', [util.getWhich('nginx')], { inherit : true })

    }

    if (!agents.getCurrent(list)) agents.write(list)

    list.forEach(function(agent) {

        let result = agents.start(agent)

        util.say(result.code === 0 ? 'ok' : 'err', agent.label + (result.code === 0 ? '' : ': ' + result.err.trim()))

    })

    for (tries = 0; tries < 45 && !up; tries++) {

        up = checks.getStatus('https://' + ctx.settings.api_host + '/api/0.1.0/status') === 200
        if (!up) util.exec('/bin/sleep', ['2'])

    }

    if (!up) {
        util.say('err', 'the api did not answer within 90 s (ducky-pro logs api)')
        return 1
    }

    util.say('ok', 'https://' + ctx.settings.api_host + ' answers')

    setPull(ctx)
    if (!ctx.no_open) util.exec('/usr/bin/open', ['https://' + ctx.settings.host])

    return 0

}

/**
 * POSTs to a pull url with curl, no headers, at most 120 s.
 *
 * @param   {string} url - The pull route
 * @returns {object} { body, status } (status 0 = no answer, body null
 *                   when not json)
 */
function getPull(url) {

    let result = util.exec('/usr/bin/curl', ['-s', '-X', 'POST', '-w', '\n%{http_code}', '--max-time', '120', url])
    let lines  = result.out.split('\n')
    let status = Number(lines.pop().trim()) || 0
    let body   = null

    try {
        body = JSON.parse(lines.join('\n'))
    } catch (e) {
        body = null
    }

    return {
        body   : body,
        status : status
    }

}

/**
 * The one status line for the boot pull's answer (L4's POST
 * /:v/local/pull): 200 { pulled, removed, ts }, 409 not linked, 401
 * revoked, 503 cloud offline; anything else a warning. Never blocks.
 *
 * @param   {number} status - The http status (0 = no answer)
 * @param   {object} body   - The parsed json body, or null
 * @param   {object} ctx    - The run context (the link page's host)
 * @returns {object} { level, text }
 */
function getPullLine(status, body, ctx) {

    let host  = ctx && ctx.settings && ctx.settings.host ? ctx.settings.host : 'ducky.localhost'
    let count = function(group) {

        let total = 0

        Object.keys(group && typeof group === 'object' ? group : {}).forEach(function(key) {

            total += Number(group[key]) || 0

        })

        return total

    }

    if (status === 200) return {
        level : 'ok',
        text  : 'pull: ' + count(body && body.pulled) + ' pulled, ' + count(body && body.removed) + ' removed'
    }
    if (status === 409) return {
        level : 'info',
        text  : 'pull: this machine is not linked yet, open https://' + host + '/local/link'
    }
    if (status === 401) return {
        level : 'warn',
        text  : 'pull: ' + (body && body.message ? body.message : 'This machine is unlinked.') + ' Link it again: open https://' + host + '/local/link'
    }
    if (status === 503) return {
        level : 'warn',
        text  : 'pull: the cloud is offline, working from the last pull'
    }

    return {
        level : 'warn',
        text  : 'pull: not done (' + (status || 'no answer') + ')'
    }

}

/**
 * Asks the local api for the boot pull (gate only: no session, no client
 * key; through nginx on the api host). One status line, never blocks the
 * start. The api also pulls by itself about 5 s after it starts, so this
 * matters when the api was already running.
 *
 * @param {object} ctx - The run context
 */
function setPull(ctx) {

    let answer = getPull('https://' + ctx.settings.api_host + '/api/0.1.0/local/pull')
    let line   = getPullLine(answer.status, answer.body, ctx)

    util.say(line.level, line.text)

}

/**
 * Stops our two agents only; refuses while a job runs (--force).
 *
 * @param   {object} ctx - The run context
 * @returns {number} Exit code
 */
function stop(ctx) {

    if (getJobRunning(ctx) && !ctx.force) {
        util.say('err', 'a job is running; ducky-pro stop --force stops it mid-way')
        return 1
    }

    agents.getAgents(ctx.settings, ctx.paths).forEach(function(agent) {

        let result = agents.stop(agent)

        util.say(result.code === 0 ? 'ok' : 'err', 'stopped ' + agent.label)

    })

    return 0

}

/**
 * One table: services, ports, pids, health, link, versions, disk.
 *
 * @param   {object} ctx - The run context
 * @returns {Promise<number>} Exit code
 */
async function status(ctx) {

    let device = config.getJSON(path.join(ctx.paths.config, 'device.json'))
    let lines  = []
    let disk   = ''

    lines.push(['mongod', (await checks.getPort(27017)) ? 'up' : 'down', '27017'])
    lines.push(['redis', (await checks.getPort(6379)) ? 'up' : 'down', '6379 db ' + ctx.settings.redis_db])
    lines.push(['nginx', nginx.getMaster() ? 'up' : 'down', String(ctx.settings.https_port || 443)])

    agents.getAgents(ctx.settings, ctx.paths).forEach(function(agent) {

        let state = agents.getState(agent.label)
        let port  = agent.side === 'api' ? ctx.settings.api_port : ctx.settings.app_port

        lines.push([agent.side, state.pid ? 'up' : (state.loaded ? 'loaded' : 'down'), port + (state.pid ? ' pid ' + state.pid : '')])

    })

    lines.push(['health', checks.getStatus('https://' + ctx.settings.api_host + '/api/0.1.0/status') === 200 ? 'ok' : 'no', 'https://' + ctx.settings.host])
    lines.push(['link', device && device.revoked ? 'unlinked (revoked)' : (device && device.device_link_id ? 'linked' : 'not linked'), device && device.last_pull ? 'last pull ' + device.last_pull : ''])

    config.repos.forEach(function(item) {

        let head = util.exec('git', ['-C', path.join(ctx.paths.repos, item.name), 'log', '--oneline', '-1', '--format=%h %cs'])

        lines.push([item.name, head.code === 0 ? head.out.trim() : 'missing', ''])

    })

    disk = util.exec('/bin/df', ['-h', ctx.paths.media]).out.split('\n')[1] || ''
    lines.push(['media', disk ? disk.split(/\s+/)[3] + ' free' : 'missing', ctx.paths.media])

    lines.forEach(function(line) {

        console.log(line[0] + ' '.repeat(Math.max(1, 24 - line[0].length)) + line[1] + ' '.repeat(Math.max(1, 12 - line[1].length)) + line[2])

    })

    return 0

}

/**
 * Updates: refuses on a running job or local changes; pulls each repo
 * (--ff-only, ducky_secrets too); then npm, envs, migrations, restart,
 * doctor.
 *
 * @param   {object} ctx - The run context
 * @returns {Promise<number>} Exit code
 */
async function update(ctx) {

    let dirty  = []
    let result = null
    let keys   = ['npm', 'config', 'migrations', 'agents']
    let index  = 0

    if (getJobRunning(ctx)) {
        util.say('err', 'a job is running, update after it')
        return 1
    }

    dirty = config.repos.filter(function(item) {

        return util.exec('git', ['-C', path.join(ctx.paths.repos, item.name), 'status', '--porcelain', '--untracked-files=no']).out.trim() !== ''

    })

    if (dirty.length) {
        util.say('err', 'local changes in ' + dirty.map(function(item) { return item.name }).join(', ') + ', update refused')
        return 1
    }

    for (index = 0; index < config.repos.length; index++) {

        result = util.exec('git', ['-C', path.join(ctx.paths.repos, config.repos[index].name), 'pull', '--ff-only', '--quiet'])

        if (result.code !== 0) {
            util.say('err', config.repos[index].name + ': git pull --ff-only failed')
            return 1
        }

    }

    for (index = 0; index < keys.length; index++) {

        let step = steps.filter(function(item) {

            return item.key === keys[index]

        })[0]

        if (step.check(ctx).ok) continue

        result = await step.apply(ctx)

        if (!result.ok) {
            util.say('err', step.key + ': ' + result.detail)
            return 1
        }

    }

    stop(ctx)
    ctx.no_open = true
    if ((await start(ctx)) !== 0) return 1

    return doctor(ctx)

}

/**
 * Prints the doctor rows.
 *
 * @param   {object} ctx - The run context
 * @returns {Promise<number>} 1 when something blocks
 */
async function doctor(ctx) {

    return checks.print(await checks.getRows(ctx)) ? 1 : 0

}

/**
 * Tails a log.
 *
 * @param   {object} ctx  - The run context
 * @param   {string} name - api, app, local, sidequest, nginx
 * @returns {number} Exit code
 */
function logs(ctx, name) {

    let files = {
        api       : 'api.log',
        app       : 'app.log',
        local     : 'local.log',
        nginx     : 'nginx_app.err.log',
        sidequest : 'sidequest.log'
    }
    let file = path.join(ctx.paths.logs, files[name || 'api'] || 'api.log')

    if (!fs.existsSync(file)) {
        util.say('err', 'no log yet: ' + file)
        return 1
    }

    return util.exec('/usr/bin/tail', ['-n', '200'].concat(ctx.follow ? ['-f'] : []).concat([file]), { inherit : true }).code

}

/**
 * Opens the link page.
 *
 * @param   {object} ctx - The run context
 * @returns {number} Exit code
 */
function link(ctx) {

    return util.exec('/usr/bin/open', ['https://' + ctx.settings.host + '/local/link']).code

}

/**
 * One flag's value.
 *
 * @param   {array}  argv - The arguments
 * @param   {string} name - The flag
 * @returns {(string|null)} The value
 */
function getArg(argv, name) {

    let index = argv.indexOf(name)

    return index !== -1 && argv[index + 1] && !/^--/.test(argv[index + 1]) ? argv[index + 1] : null

}

/**
 * One flag's comma list.
 *
 * @param   {array}  argv - The arguments
 * @param   {string} name - The flag
 * @returns {array} The items
 */
function getList(argv, name) {

    return (getArg(argv, name) || '').split(',').filter(Boolean)

}

/**
 * The run context from the command line.
 *
 * @param   {array}  argv - process.argv.slice(2)
 * @param   {string} verb - The command
 * @returns {object} The context
 */
function getContext(argv, verb) {

    let install  = verb === 'install'
    let home     = config.getHomeFound(getArg(argv, '--path') || getArg(argv, '--root'), install)
    let settings = null

    // IMPORTANT
    // install never takes the home folder itself or the installer repo,
    // every other command needs an existing install

    if (!home) throw new Error('no install found: run in the install folder or pass --path <dir>')
    if (install && home === os.homedir()) throw new Error('not into the home folder itself: pass --path <dir> or run in an empty folder')
    if (install && (home + path.sep).indexOf(util.dir_root + path.sep) === 0) throw new Error('not into the installer repo: pass --path <dir> or run in another folder')

    config.setHome(home)

    settings = config.getSettings()

    if (!settings.node || !fs.existsSync(settings.node)) settings.node = packages.getNode() || null

    return {
        dry        : argv.indexOf('--dry-run') !== -1,
        follow     : argv.indexOf('-f') !== -1 || argv.indexOf('--follow') !== -1,
        force      : argv.indexOf('--force') !== -1,
        no_open    : argv.indexOf('--no-open') !== -1,
        no_sudo    : argv.indexOf('--no-sudo') !== -1,
        only       : getList(argv, '--only'),
        paths      : config.getPaths(settings),
        settings   : settings,
        skip       : getList(argv, '--skip'),
        yes        : argv.indexOf('--yes') !== -1
    }

}

module.exports = {
    doctor,
    getContext,
    getPull,
    getPullLine,
    install,
    link,
    logs,
    start,
    status,
    stop,
    update
}
