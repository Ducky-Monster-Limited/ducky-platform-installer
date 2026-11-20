// update.js — `ducky-pro update` follows the pro releases (lib/release.js),
// on fake repos in a temp folder, nothing outside touched, no service
// stopped or started:
//   - versions: parse, compare, label, highest
//   - a release resolves per repo: app_pro by tag, api by its build
//     commit on main, cli by the api's lib_cli_pro ref, shared / app /
//     design by the release's time, ducky_secrets main
//   - update --check and --dry-run say the latest release and change
//     nothing; the moves land all together, secrets stay on main
//   - a newer release is seen; a release without its api build commit is
//     refused; a failed checkout puts every repo back; --main is main;
//     local changes refuse the update
//
// usage: node test/update.js [--keep]

let child_process = require('child_process')
let fs            = require('fs')
let os            = require('os')
let path          = require('path')

// ---

let dir_root = path.resolve(__dirname, '..')
let rows     = []

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
 * Runs git in a folder at a fixed time.
 *
 * @param   {string} dir  - The repo
 * @param   {array}  args - git arguments
 * @param   {number} time - Unix seconds for author and committer
 * @returns {string} stdout, trimmed
 */
function git(dir, args, time) {

    let stamp  = '@' + String(1700000000 + (time || 0)) + ' +0000'
    let result = child_process.spawnSync('git', ['-C', dir].concat(args), {
        encoding : 'utf8',
        env      : Object.assign({}, process.env, {
            GIT_AUTHOR_DATE     : stamp,
            GIT_AUTHOR_EMAIL    : 'test@example.com',
            GIT_AUTHOR_NAME     : 'test',
            GIT_COMMITTER_DATE  : stamp,
            GIT_COMMITTER_EMAIL : 'test@example.com',
            GIT_COMMITTER_NAME  : 'test'
        })
    })

    if (result.status !== 0) throw new Error('git ' + args.join(' ') + ': ' + result.stderr)

    return result.stdout.trim()

}

/**
 * One commit in an origin repo.
 *
 * @param   {string} dir     - The repo
 * @param   {string} file    - File to write
 * @param   {string} text    - Its content
 * @param   {string} message - The commit message
 * @param   {number} time    - Unix seconds
 * @returns {string} The sha
 */
function commit(dir, file, text, message, time) {

    fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive : true })
    fs.writeFileSync(path.join(dir, file), text)
    git(dir, ['add', file], time)
    git(dir, ['commit', '--quiet', '-m', message], time)

    return git(dir, ['rev-parse', 'HEAD'])

}

/**
 * The api's lib_cli_pro.js with a cli ref.
 *
 * @param   {string} ref - The ref
 * @returns {string} The file
 */
function getCliFile(ref) {

    return 'const config = {\n    marker      : \'.pro_cli.json\',\n    ref         : \'' + ref + '\',\n    root        : \'.cli_pro\'\n}\n'

}

/**
 * Runs the ducky-pro command.
 *
 * @param   {array}  args - Arguments
 * @param   {object} env  - Extra env
 * @returns {object} { code, out }
 */
function run(args, env) {

    let result = child_process.spawnSync(process.execPath, [path.join(dir_root, 'bin', 'ducky-pro')].concat(args), {
        encoding : 'utf8',
        env      : Object.assign({}, process.env, env),
        input    : ''
    })

    return {
        code : result.status,
        out  : result.stdout + result.stderr
    }

}

/**
 * The run.
 *
 * @returns {number} Exit code
 */
function main() {

    let tmp     = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'ducky-update-'))
    let origins = path.join(tmp, 'origins')
    let home    = path.join(tmp, 'DuckyTest')
    let repos   = path.join(home, 'repos')
    let env     = {
        DUCKY_HOME          : home,
        DUCKY_HOME_FILE     : path.join(tmp, '.ducky_home'),
        DUCKY_LAUNCH_AGENTS : path.join(tmp, 'LaunchAgents')
    }
    let names   = ['ducky_platform_api', 'ducky_platform_app_pro', 'ducky_platform_shared', 'ducky_platform_app', 'ducky_cli', 'ducky_design', 'ducky_secrets']
    let sha     = {}
    let config  = null
    let release = null
    let ctx     = null
    let target  = null
    let result  = null
    let heads   = null
    let out     = null

    // ORIGINS: two releases, work after them

    names.forEach(function(name) {

        fs.mkdirSync(path.join(origins, name), { recursive : true })
        git(path.join(origins, name), ['init', '--quiet', '-b', 'main'])

    })

    sha.cli1 = commit(path.join(origins, 'ducky_cli'), 'cli.txt', 'k1', 'cli one', 50)
    sha.cli2 = commit(path.join(origins, 'ducky_cli'), 'cli.txt', 'k2', 'cli two', 250)
    sha.cli3 = commit(path.join(origins, 'ducky_cli'), 'cli.txt', 'k3', 'cli three', 450)

    sha.shared1 = commit(path.join(origins, 'ducky_platform_shared'), 's.txt', 's1', 'shared one', 80)
    sha.shared2 = commit(path.join(origins, 'ducky_platform_shared'), 's.txt', 's2', 'shared two', 295)
    sha.shared3 = commit(path.join(origins, 'ducky_platform_shared'), 's.txt', 's3', 'shared three', 600)

    sha.api1 = commit(path.join(origins, 'ducky_platform_api'), 'app/services/jobs/lib_cli_pro.js', getCliFile(sha.cli1.slice(0, 7)), '0.0.1-pro-rc1: first (cli ref ' + sha.cli1.slice(0, 7) + ')', 90)
    sha.api2 = commit(path.join(origins, 'ducky_platform_api'), 'app/services/jobs/lib_cli_pro.js', getCliFile(sha.cli2.slice(0, 7)), '0.0.1-pro-rc2', 290)
    sha.api3 = commit(path.join(origins, 'ducky_platform_api'), 'app/services/jobs/lib_cli_pro.js', getCliFile(sha.cli3.slice(0, 7)), 'later work, mentions 0.0.1-pro-rc2: in passing', 480)

    sha.pro1 = commit(path.join(origins, 'ducky_platform_app_pro'), 'p.txt', 'p1', '0.0.1-pro-rc1: first', 100)
    git(path.join(origins, 'ducky_platform_app_pro'), ['tag', '0.0.1-pro-rc1'])
    sha.pro2 = commit(path.join(origins, 'ducky_platform_app_pro'), 'p.txt', 'p2', '0.0.1-pro-rc2: second', 300)
    git(path.join(origins, 'ducky_platform_app_pro'), ['tag', '0.0.1-pro-rc2'])
    git(path.join(origins, 'ducky_platform_app_pro'), ['tag', 'pre-pro-port'])
    sha.pro3 = commit(path.join(origins, 'ducky_platform_app_pro'), 'p.txt', 'p3', 'later work', 500)

    sha.app1    = commit(path.join(origins, 'ducky_platform_app'), 'a.txt', 'a1', 'app one', 10)
    sha.app2    = commit(path.join(origins, 'ducky_platform_app'), 'a.txt', 'a2', 'app two', 700)
    sha.design1 = commit(path.join(origins, 'ducky_design'), 'd.txt', 'd1', 'design one', 10)
    sha.design2 = commit(path.join(origins, 'ducky_design'), 'd.txt', 'd2', 'design two', 700)
    sha.secret1 = commit(path.join(origins, 'ducky_secrets'), 'dev.json', '{}', 'secrets one', 10)
    sha.secret2 = commit(path.join(origins, 'ducky_secrets'), 'dev.json', '{"a":1}', 'secrets two', 800)

    // THE INSTALL: clones on main (as installs before releases were)

    fs.mkdirSync(path.join(home, 'config'), { recursive : true })
    fs.writeFileSync(path.join(home, 'config', 'ducky.json'), JSON.stringify({
        api_host   : 'api.ducky-update-test.invalid',
        clone_base : origins,
        host       : 'ducky-update-test.invalid',
        instance   : 'updatetest'
    }, null, 4) + '\n')

    names.forEach(function(name) {

        git(tmp, ['clone', '--quiet', path.join(origins, name), path.join(repos, name)])

    })

    // VERSIONS

    process.env.DUCKY_HOME_FILE = env.DUCKY_HOME_FILE
    config  = require('../lib/config')
    release = require('../lib/release')

    check('versions: parse', JSON.stringify(release.getParts('0.0.1-pro-rc11')) === '[0,0,1,11]' && release.getParts('0.0.1-platform-rc5') === null && release.getParts('pre-pro-port') === null)
    check('versions: rc11 newer than rc9, none older than nothing', release.getNewer('0.0.1-pro-rc11', '0.0.1-pro-rc9') && !release.getNewer('0.0.1-pro-rc9', '0.0.1-pro-rc11') && !release.getNewer('0.0.1-pro-rc9', '0.0.1-pro-rc9') && release.getNewer('0.0.1-pro-rc1', null) && !release.getNewer('main', null))
    check('versions: label + highest', release.getLabel('0.0.1-pro-rc12') === 'rc12' && release.getHighest(['0.0.1-pro-rc9', '0.0.1-pro-rc11', '0.0.1-platform-rc5', 'v2', '0.0.1-pro-rc10']) === '0.0.1-pro-rc11')

    // CHECK + DRY RUN: the latest, nothing changed

    out = run(['update', '--check'], env)
    check('update --check: rc2 available', out.code === 0 && /latest release: 0\.0\.1-pro-rc2 \(tags\), update rc2 available/.test(out.out), out.out.trim().split('\n').slice(-1)[0])

    heads = names.map(function(name) { return git(path.join(repos, name), ['rev-parse', 'HEAD']) }).join(',')
    out = run(['update', '--dry-run'], env)
    check('update --dry-run: plans rc2, exits 0', out.code === 0 && /update to 0\.0\.1-pro-rc2 \(tags\) \(dry run\)/.test(out.out) && new RegExp('ducky_platform_api: ' + sha.api3.slice(0, 8) + ' -> ' + sha.api2.slice(0, 8)).test(out.out), out.code !== 0 ? out.out.trim() : '')
    check('update --dry-run: no HEAD moved, no record', heads === names.map(function(name) { return git(path.join(repos, name), ['rev-parse', 'HEAD']) }).join(',') && !fs.existsSync(path.join(home, 'config', 'release.json')))

    // RESOLVE + MOVE (the library: update's stop/start left out)

    config.setHome(home)
    ctx = {
        paths    : config.getPaths(config.getSettings()),
        settings : config.getSettings()
    }
    target = release.getTarget(ctx, '0.0.1-pro-rc2')

    check('rc2: app_pro on its tag', target.refs.ducky_platform_app_pro === sha.pro2)
    check('rc2: api on its build commit (subject is the version), not a later mention', target.refs.ducky_platform_api === sha.api2)
    check('rc2: cli on the api\'s lib_cli_pro ref', target.refs.ducky_cli === sha.cli2)
    check('rc2: shared, app, design at the release time', target.refs.ducky_platform_shared === sha.shared2 && target.refs.ducky_platform_app === sha.app1 && target.refs.ducky_design === sha.design1)
    check('rc2: secrets on main', target.refs.ducky_secrets === sha.secret2 && !target.missing.length, target.missing.join(', '))

    result = release.checkout(ctx, target)
    release.setRecord(ctx, target)
    check('checkout: every repo moved, none failed', !result.failed && names.every(function(name) { return git(path.join(repos, name), ['rev-parse', 'HEAD']) === target.refs[name] }))
    check('checkout: release repos detached, secrets on main', git(path.join(repos, 'ducky_secrets'), ['rev-parse', '--abbrev-ref', 'HEAD']) === 'main' && git(path.join(repos, 'ducky_platform_api'), ['rev-parse', '--abbrev-ref', 'HEAD']) === 'HEAD')
    check('record: config/release.json 0600 with version, mode, refs, command', (function() {

        let record = JSON.parse(fs.readFileSync(path.join(home, 'config', 'release.json'), 'utf8'))

        return record.version === '0.0.1-pro-rc2' && record.mode === 'release' && record.refs.ducky_cli === sha.cli2 && /bin\/ducky-pro$/.test(record.installer) && (fs.statSync(path.join(home, 'config', 'release.json')).mode & 0o777) === 0o600

    })())

    out = run(['update', '--check'], env)
    check('update --check after: up to date', out.code === 0 && /installed: 0\.0\.1-pro-rc2/.test(out.out) && /, up to date/.test(out.out))
    out = run(['update', '--dry-run'], env)
    check('update --dry-run after: nothing to move', out.code === 0 && /every repo is on 0\.0\.1-pro-rc2/.test(out.out) && !/\[plan\]/.test(out.out))

    // A NEWER RELEASE

    sha.api4 = commit(path.join(origins, 'ducky_platform_api'), 'build/0.0.1-pro-rc3/VERSION', '0.0.1-pro-rc3', '0.0.1-pro-rc3: third (cli ref ' + sha.cli3.slice(0, 7) + ')', 900)
    git(path.join(origins, 'ducky_platform_app_pro'), ['tag', '0.0.1-pro-rc3'])

    out = run(['update', '--check'], env)
    check('a newer release: update rc3 available', /update rc3 available/.test(out.out))
    out = run(['update', '--dry-run'], env)
    check('a newer release: dry run plans api, app_pro, cli, shared, app, design', out.code === 0 && ['ducky_platform_api', 'ducky_platform_app_pro', 'ducky_cli', 'ducky_platform_shared', 'ducky_platform_app', 'ducky_design'].every(function(name) { return new RegExp('\\[plan\\]\\s+' + name + ':').test(out.out) }))

    // AN INCOMPLETE RELEASE: a tag without the api's build commit

    git(path.join(origins, 'ducky_platform_app_pro'), ['tag', '0.0.1-pro-rc4'])
    out = run(['update', '--dry-run'], env)
    check('rc4 without its api build commit: refused, nothing moved', out.code === 1 && /0\.0\.1-pro-rc4 is not complete: ducky_platform_api/.test(out.out) && git(path.join(repos, 'ducky_platform_api'), ['rev-parse', 'HEAD']) === sha.api2)
    out = run(['update', '--dry-run', '--release', '0.0.1-pro-rc3'], env)
    check('--release rc3: that one', out.code === 0 && /update to 0\.0\.1-pro-rc3 \(--release\)/.test(out.out))

    // A FAILED CHECKOUT PUTS EVERY REPO BACK

    release.fetch(ctx)
    target = release.getTarget(ctx, '0.0.1-pro-rc3')
    target.refs.ducky_design = '0123456789012345678901234567890123456789'
    result = release.checkout(ctx, target)
    check('failed checkout: named, every repo back on rc2', result.failed === 'ducky_design' && git(path.join(repos, 'ducky_platform_api'), ['rev-parse', 'HEAD']) === sha.api2 && git(path.join(repos, 'ducky_cli'), ['rev-parse', 'HEAD']) === sha.cli2 && git(path.join(repos, 'ducky_secrets'), ['rev-parse', '--abbrev-ref', 'HEAD']) === 'main')

    // MAIN, DELIBERATELY

    out = run(['update', '--dry-run', '--main'], env)
    check('update --main --dry-run: plans main', out.code === 0 && /update to main \(dry run\)/.test(out.out) && new RegExp('ducky_platform_api: ' + sha.api2.slice(0, 8) + ' -> ' + sha.api4.slice(0, 8)).test(out.out))
    target = release.getTargetMain(ctx)
    result = release.checkout(ctx, target)
    check('main: every repo on branch main at origin/main', !result.failed && names.every(function(name) { return git(path.join(repos, name), ['rev-parse', '--abbrev-ref', 'HEAD']) === 'main' && git(path.join(repos, name), ['rev-parse', 'HEAD']) === git(path.join(repos, name), ['rev-parse', 'origin/main']) }))

    // LOCAL CHANGES REFUSE

    fs.writeFileSync(path.join(repos, 'ducky_cli', 'cli.txt'), 'changed')
    out = run(['update', '--dry-run'], env)
    check('local changes: update refused', out.code === 1 && /local changes in ducky_cli, update refused/.test(out.out))

    if (process.argv.indexOf('--keep') === -1) {
        fs.rmSync(tmp, { force : true, recursive : true })
    } else {
        console.log('[info] kept ' + tmp)
    }

    return rows.every(Boolean) ? 0 : 1

}

// ---

process.exitCode = main()
