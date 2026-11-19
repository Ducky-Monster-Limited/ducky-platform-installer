// 07_python.js — the cli's python separator: ~/.ducky-demucs (the path the
// cli expects), created only when missing. The cli's other python
// modules are doctor rows (they install into the user's python3).

let fs   = require('fs')
let os   = require('os')
let path = require('path')

let util = require('../util')

// ---

let venv = path.join(os.homedir(), '.ducky-demucs')

module.exports = {
    key   : 'python',
    sudo  : false,
    title : 'the demucs venv (~/.ducky-demucs)',
    apply : function() {

        let python = util.getWhich('python3.11') || 'python3'
        let result = util.exec(python, ['-m', 'venv', venv], { inherit : true })

        if (result.code === 0) result = util.exec(path.join(venv, 'bin', 'pip'), ['install', 'demucs', 'soundfile'], { inherit : true, timeout : 60 * 60 * 1000 })

        return { detail : 'venv + demucs exited ' + result.code, ok : result.code === 0 }

    },
    check : function() {

        if (!fs.existsSync(path.join(venv, 'bin', 'python3'))) return { detail : 'python3.11 -m venv ~/.ducky-demucs && pip install demucs soundfile', ok : false }

        return { detail : venv + ' (kept as it is)', ok : true }

    }
}
