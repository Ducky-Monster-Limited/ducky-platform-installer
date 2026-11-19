// sidequest.js — the sidequest config step (plan_0011 §3, §4 step 7) on a
// temp DUCKY_HOME, no terminal (the questions answer empty): the example
// without a password, this install's whisper paths, 0600, idempotent, an
// existing file (a password and the foot's workspace in it) never
// rewritten, only its mode put back. The password is never printed.
//
// usage: node test/sidequest.js

let fs   = require('fs')
let os   = require('os')
let path = require('path')

// ---

let rows = []
let home = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ducky-sq-')))

process.env.DUCKY_HOME = home

let config = require('../lib/config')
let step   = require('../lib/steps/18_sidequest')

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

async function main() {

    let paths    = config.getPaths({})
    let ctx      = { paths : paths, settings : config.getSettings() }
    let file     = path.join(paths.config, 'sidequest.json')
    let secret   = 'pw-sq-test-' + Date.now()
    let data     = null
    let before   = null
    let result   = null

    fs.mkdirSync(paths.config, { recursive : true, mode : 0o700 })

    check('check before: not ok', step.check(ctx).ok === false)

    result = await step.apply(ctx)
    data = JSON.parse(fs.readFileSync(file, 'utf8'))

    check('apply writes the file', result.ok && fs.existsSync(file), result.detail)
    check('mode 0600', (fs.statSync(file).mode & 0o777) === 0o600)
    check('no password in the example', data.obs.password === '')
    check('whisper model at the installer\'s models folder', data.whisper.model === path.join(paths.models, 'ggml-large-v3-turbo.bin'), data.whisper.model)
    check('whisper-cli of the brew prefix', data.whisper.bin === path.join(paths.brew, 'bin', 'whisper-cli'))
    check('recordings default ~/Movies, workspace default', data.recordings === '~/Movies' && data.workspace_id === null)
    check('check after: ok, says no password yet', step.check(ctx).ok && /no OBS password yet/.test(step.check(ctx).detail))

    // the person (or the foot) filled it: never rewritten
    data.obs.password = secret
    data.workspace_id = '6af910334ca94524abd125e2'
    fs.writeFileSync(file, JSON.stringify(data, null, 4) + '\n')
    fs.chmodSync(file, 0o644)
    before = fs.readFileSync(file, 'utf8')

    check('check: 644 is not ok', step.check(ctx).ok === false)

    result = await step.apply(ctx)

    check('apply again keeps the content', fs.readFileSync(file, 'utf8') === before)
    check('apply again puts 0600 back', (fs.statSync(file).mode & 0o777) === 0o600)
    check('no answer carries the password', JSON.stringify([result, step.check(ctx)]).indexOf(secret) === -1)

    fs.rmSync(home, { force : true, recursive : true })

    console.log(rows.every(Boolean) ? '\nall ' + rows.length + ' passed' : '\n' + rows.filter(function(row) { return !row }).length + ' failed')
    process.exit(rows.every(Boolean) ? 0 : 1)

}

main()
