// brand.js — the ducky cli's look for ducky-pro: the DUCKY MONSTER logo
// and the help with full-width colour bars (ducky_cli ducky.sh
// ducky_logo, lib/log.sh _help_style and its _CLR_* colours). Colour only
// on a terminal and without NO_COLOR, so piped output (the tests) stays
// plain.

let child_process = require('child_process')
let path          = require('path')

// ---

let colours = {
    bar_cmd : '\x1b[38;2;255;255;255m\x1b[48;2;0;204;255m',
    bar_opt : '\x1b[38;2;255;255;255m\x1b[48;2;150;97;255m',
    bar_use : '\x1b[38;2;0;0;0m\x1b[48;2;246;254;98m',
    dim     : '\x1b[2m',
    err     : '\x1b[38;2;250;29;25m',
    ok      : '\x1b[38;2;199;255;112m',
    reset   : '\x1b[0m',
    yellow  : '\x1b[38;2;246;254;98m'
}

// the tag colours of util.say / the health rows
let tags = {
    dry  : 'dim',
    err  : 'err',
    info : 'dim',
    ok   : 'ok',
    plan : 'yellow',
    skip : 'dim',
    sudo : 'yellow',
    warn : 'yellow'
}

let logo = [
    '',
    '        ██████╗ ██╗   ██╗ ██████╗██╗  ██╗██╗   ██╗',
    '        ██╔══██╗██║   ██║██╔════╝██║ ██╔╝╚██╗ ██╔╝',
    '        ██║  ██║██║   ██║██║     █████╔╝  ╚████╔╝',
    '        ██║  ██║██║   ██║██║     ██╔═██╗   ╚██╔╝',
    '        ██████╔╝╚██████╔╝╚██████╗██║  ██╗   ██║',
    '        ╚═════╝  ╚═════╝  ╚═════╝╚═╝  ╚═╝   ╚═╝',
    '           ███╗   ███╗ ██████╗ ███╗   ██╗███████╗████████╗███████╗██████╗',
    '           ████╗ ████║██╔═══██╗████╗  ██║██╔════╝╚══██╔══╝██╔════╝██╔══██╗',
    '           ██╔████╔██║██║   ██║██╔██╗ ██║███████╗   ██║   █████╗  ██████╔╝',
    '           ██║╚██╔╝██║██║   ██║██║╚██╗██║╚════██║   ██║   ██╔══╝  ██╔══██╗',
    '           ██║ ╚═╝ ██║╚██████╔╝██║ ╚████║███████║   ██║   ███████╗██║  ██║',
    '           ╚═╝     ╚═╝ ╚═════╝ ╚═╝  ╚═══╝╚══════╝   ╚═╝   ╚══════╝╚═╝  ╚═╝',
    ''
]

let help = [
    'Usage:',
    '',
    ' ducky-pro <command> [options]',
    '',
    'Commands:',
    '',
    ' install                  set up or repair this machine (guided, asks first)',
    ' start                    api + app as background services, opens https://ducky.localhost',
    ' stop                     stop both (--force stops a running job mid-way)',
    ' status                   services, ports, health, link, repos, disk',
    ' health                   every check of the install, with the fix',
    ' update                   pull the repos (ducky_secrets too), envs, migrations, restart',
    ' logs [api|app|local|sidequest|nginx]   the logs (-f follows)',
    ' link                     open the page that links this machine to the cloud',
    ' whisper [install]        the optional offline transcription fallback (whisper.cpp)',
    '',
    'Install Options:',
    '',
    '~ --path <dir>             the install folder (else DUCKY_HOME, else here)',
    '~ --dry-run                show what would happen, change nothing',
    '~ --yes                    apply the non-sudo steps without asking',
    '~ --no-sudo                list the sudo steps instead of asking',
    '~ --only a,b / --skip a,b  run some steps only / leave some out',
    '~ --with whisper           also the optional whisper fallback (1.6 GB)',
    '',
    'Global Options:',
    '',
    '~ --help, -h               show this help',
    '~ --version, -v            show the installer\'s version',
    '',
    ' `ducky` is the video cli; this is ducky-pro, the local platform.'
]

/**
 * Whether stdout takes colour.
 *
 * @returns {boolean} True on a terminal without NO_COLOR
 */
function getColour() {

    return !!process.stdout.isTTY && !process.env.NO_COLOR

}

/**
 * A text in one colour (plain when there is none).
 *
 * @param   {string} name - A key of colours
 * @param   {string} text - The text
 * @returns {string} The coloured text
 */
function paint(name, text) {

    return getColour() && colours[name] ? colours[name] + text + colours.reset : text

}

/**
 * The colour of a status tag.
 *
 * @param   {string} tag - ok, err, plan, …
 * @returns {string} The tag in brackets, coloured
 */
function getTag(tag) {

    return paint(tags[tag] || 'dim', '[' + tag + ']')

}

/**
 * The installer's version: its short commit (and the date).
 *
 * @returns {string} e.g. 94811c4 2026-11-19
 */
function getVersion() {

    let result = child_process.spawnSync('git', ['-C', path.resolve(__dirname, '..'), 'log', '-1', '--format=%h %cs'], { encoding : 'utf8' })

    return result.status === 0 ? String(result.stdout).trim() : 'unknown'

}

/**
 * Prints the logo with the version line under it, line by line on a
 * terminal (it comes in, ~0.3 s), at once when piped.
 */
function showLogo() {

    let pause = getColour() ? new Int32Array(new SharedArrayBuffer(4)) : null

    logo.forEach(function(line) {

        console.log(line)

        if (pause && line) Atomics.wait(pause, 0, 0, 25)

    })
    console.log('                         ' + paint('yellow', 'pro') + ' · local platform · ' + paint('dim', getVersion()))
    console.log('')

}

/**
 * Prints the help, its section lines as full-width bars (the cli's
 * _help_style: Usage yellow, Commands purple, Options cyan, ~ dim).
 */
function showHelp() {

    let width = Math.max(60, Math.min(process.stdout.columns || 80, 120))
    let bar   = function(name, title) {

        let text = ' ' + title.toUpperCase()

        return getColour() ? colours[name] + text + ' '.repeat(Math.max(0, width - text.length)) + colours.reset : text

    }

    help.forEach(function(line) {

        if (line === 'Usage:') return console.log('\n' + bar('bar_use', 'usage'))
        if (line === 'Commands:') return console.log(bar('bar_opt', 'commands'))
        if (/Options:$/.test(line)) return console.log(bar('bar_cmd', line.slice(0, -1)))
        if (line.indexOf('~') === 0) return console.log(paint('dim', line.slice(1)))

        console.log(line)

    })
    console.log('')

}

module.exports = {
    getTag,
    getVersion,
    paint,
    showHelp,
    showLogo
}
