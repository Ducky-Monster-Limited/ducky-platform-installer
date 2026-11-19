// 05_sources.js — the platform code and the team's secrets: git clones
// of the org's repos over ssh (05a_github made that work).

let sources = require('../sources')

// ---

module.exports = {
    key   : 'sources',
    sudo  : false,
    title : 'the platform code + ducky-secrets (git clones over ssh)',
    apply : function(ctx) {

        let failed = []

        sources.getMissingClones(ctx.paths).forEach(function(item) {

            if (sources.clone(ctx.settings, ctx.paths, item).code !== 0) failed.push(item.name)

        })

        return failed.length ? { detail : 'clone failed: ' + failed.join(', '), ok : false } : { detail : 'cloned', ok : true }

    },
    check : function(ctx) {

        let missing = sources.getMissingClones(ctx.paths)

        return missing.length ? { detail : 'git clone ' + missing.map(function(item) { return item.name }).join(', '), ok : false } : { detail : 'clones present', ok : true }

    }
}
