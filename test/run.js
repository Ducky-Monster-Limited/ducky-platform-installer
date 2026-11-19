// run.js — the installer's tests (plan_0011 §12, installer row), no sudo,
// nothing outside a temp folder:
//   - nginx render: loopback listens only, every token filled, the api's
//     dialog timeout, the probe location
//   - plist render: plutil -lint, our labels, the env file
//   - install twice on a temp DUCKY_HOME (instance "test", shifted ports,
//     a local release bundle, temp launchd / nginx / hosts targets): the
//     second run applies nothing
//   - the existing mongod, the real nginx servers folder, /etc/hosts and
//     ~/Library/LaunchAgents are the same before and after
//
// usage: node test/run.js --bundle <dir holding bundle-<n>/> [--keep]
//        (build one with scripts/release-bundle.js --n <n> --out <dir>/bundle-<n>)

let child_process = require('child_process')
let crypto        = require('crypto')
let fs            = require('fs')
let os            = require('os')
let path          = require('path')

// ---

let dir_root = path.resolve(__dirname, '..')
let rows     = []

/**
 * One command line value.
 *
 * @param   {string} name     - The flag
 * @param   {*}      fallback - The value when missing
 * @returns {*} The value
 */
function arg(name, fallback) {

    let index = process.argv.indexOf(name)

    return index !== -1 && process.argv[index + 1] ? process.argv[index + 1] : fallback

}

/**
 * Records and prints one row.
 *
 * @param {string}  label  - What
 * @param {boolean} passed - Result
 * @param {string}  detail - Extra
 */
function check(label, passed, detail) {

    rows.push(passed)
    console.log((passed ? '[ok]  ' : '[err] ') + label + (detail ? ' — ' + detail : ''))

}

/**
 * A fingerprint of what the installer must never touch.
 *
 * @returns {object} The fingerprint
 */
function getUntouched() {

    let mongod = child_process.spawnSync('/bin/ps', ['-axo', 'pid=,command='], { encoding : 'utf8' }).stdout.split('\n').filter(function(line) {

        return /\bmongod\b/.test(line) && !/grep/.test(line)

    }).map(function(line) {

        return line.trim()

    }).sort().join('\n')
    let hash = function(file) {

        try {
            return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')
        } catch (e) {
            return 'none'
        }

    }
    let list = function(dir) {

        try {
            return fs.readdirSync(dir).sort().join(',')
        } catch (e) {
            return 'none'
        }

    }

    return {
        agents : list(path.join(os.homedir(), 'Library', 'LaunchAgents')),
        hosts  : hash('/etc/hosts'),
        mongod : mongod,
        nginx  : list('/opt/homebrew/etc/nginx/servers') + '|' + hash('/opt/homebrew/etc/nginx/nginx.conf')
    }

}

/**
 * Runs `ducky install` for the temp home.
 *
 * @param   {object} env - Extra env
 * @returns {object} { applied, code, out }
 */
function install(env) {

    let result = child_process.spawnSync(process.execPath, [path.join(dir_root, 'bin', 'ducky'), 'install', '--yes', '--no-sudo', '--skip', 'npm,whisper'], {
        encoding : 'utf8',
        env      : Object.assign({}, process.env, env),
        input    : ''
    })
    let applied = /\[info\] (\d+) step\(s\) applied/.exec(result.stdout)

    return {
        applied : applied ? Number(applied[1]) : -1,
        code    : result.status,
        out     : result.stdout + result.stderr
    }

}

/**
 * The run.
 *
 * @returns {number} Exit code
 */
function main() {

    let bundles  = arg('--bundle', null)
    let tmp      = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'ducky-test-'))
    let home     = path.join(tmp, 'DuckyTest')
    let env      = {
        DUCKY_HOME          : home,
        DUCKY_HOSTS_FILE    : path.join(tmp, 'hosts'),
        DUCKY_LAUNCH_AGENTS : path.join(tmp, 'LaunchAgents'),
        DUCKY_NGINX_SERVERS : path.join(tmp, 'nginx_servers')
    }
    let settings = {
        api_database : 'ducky_test_api',
        api_host     : 'api.ducky-test.localhost',
        api_port     : 4271,
        app_database : 'ducky_test_app',
        app_port     : 4272,
        host         : 'ducky-test.localhost',
        https_port   : 14443,
        instance     : 'test',
        mode         : 'release',
        redis_db     : 5,
        release      : { current : null, local_dir : bundles, repo : 'ducky-platform-installer' }
    }
    let before   = getUntouched()
    let first    = null
    let second   = null
    let after    = null
    let conf     = null
    let plist    = null
    let lint     = null
    let envs     = null

    if (!bundles) {
        console.log('[err] --bundle <dir holding bundle-<n>/> is required')
        return 2
    }

    fs.writeFileSync(env.DUCKY_HOSTS_FILE, '127.0.0.1 localhost\n')
    fs.mkdirSync(path.join(home, 'config'), { recursive : true })
    fs.writeFileSync(path.join(home, 'config', 'ducky.json'), JSON.stringify(settings, null, 4) + '\n')

    // install twice
    first = install(env)
    check('first install exits 0', first.code === 0, first.code !== 0 ? first.out.split('\n').filter(function(line) { return /\[err\]/.test(line) }).join(' | ') : first.applied + ' step(s) applied')
    second = install(env)
    check('second install applies nothing', second.code === 0 && second.applied === 0, second.applied + ' step(s) applied')

    // what landed
    conf = fs.readFileSync(path.join(env.DUCKY_NGINX_SERVERS, 'ducky_local_test.conf'), 'utf8')
    check('nginx: loopback listens only', /listen 127\.0\.0\.1:14443 ssl;/.test(conf) && /listen \[::1\]:14443 ssl;/.test(conf) && !/listen\s+(\d+|\[::\]:\d+)\s/.test(conf))
    check('nginx: every token filled', !/\{\{/.test(conf))
    check('nginx: api dialog timeout >= 660 s', /server_name api\.ducky-test\.localhost;[\s\S]*proxy_read_timeout 660;/.test(conf))
    check('nginx: probe location', /location = \/__ducky_nginx/.test(conf))
    plist = path.join(env.DUCKY_LAUNCH_AGENTS, 'com.duckymonster.ducky.test.api.plist')
    lint = child_process.spawnSync('/usr/bin/plutil', ['-lint', plist], { encoding : 'utf8' })
    check('plist: plutil -lint', lint.status === 0, lint.stdout.trim())
    check('plist: env file + production mode', /env\.local\.api\.json/.test(fs.readFileSync(plist, 'utf8')) && /<string>production<\/string>/.test(fs.readFileSync(plist, 'utf8')))
    check('hosts: test block in the temp hosts file', /127\.0\.0\.1 ducky-test\.localhost api\.ducky-test\.localhost/.test(fs.readFileSync(env.DUCKY_HOSTS_FILE, 'utf8')))
    check('config: 0700, secrets 0600', (fs.statSync(path.join(home, 'config')).mode & 0o777) === 0o700 && (fs.statSync(path.join(home, 'config', 'secrets.json')).mode & 0o777) === 0o600)
    envs = JSON.parse(fs.readFileSync(path.join(home, 'repos', 'ducky_platform_api', 'env.local.api.json'), 'utf8'))
    check('api env: local block, ports, db, driver', envs.local && envs.local.on === true && envs.http.port === 4271 && /\/ducky_test_api$/.test(envs.mongo.url) && envs.services.productions.media_driver === 'local' && envs.services.productions.media_root === path.join(home, 'media'))
    check('api env: the install\'s client pair, system files from the bundle', !!(envs.platform.client && envs.platform.client.client_key) && /ducky_design\/lib\/system-defaults\.json$/.test(envs.services.system.catalog || ''))
    check('api env: sources path_roots', Array.isArray(envs.services.sources.path_roots) && envs.services.sources.path_roots[0] === os.homedir())
    check('migrations recorded', /000-baseline\.js/.test(fs.readFileSync(path.join(home, 'config', 'migrations.json'), 'utf8')))

    // nothing outside touched
    after = getUntouched()
    check('mongod untouched (pid + args)', before.mongod === after.mongod && before.mongod !== '', before.mongod.split('\n').length + ' process(es)')
    check('real nginx servers + nginx.conf untouched', before.nginx === after.nginx)
    check('/etc/hosts untouched', before.hosts === after.hosts)
    check('~/Library/LaunchAgents untouched', before.agents === after.agents)

    if (process.argv.indexOf('--keep') === -1) {
        fs.rmSync(tmp, { force : true, recursive : true })
    } else {
        console.log('[info] kept ' + tmp)
    }

    return rows.every(Boolean) ? 0 : 1

}

// ---

process.exitCode = main()
