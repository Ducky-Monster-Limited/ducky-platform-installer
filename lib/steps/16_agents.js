// 16_agents.js — the launchd plists of the api and the app (`ducky-pro start`
// loads them).

let agents = require('../agents')

// ---

module.exports = {
    key   : 'agents',
    sudo  : false,
    title : 'the launchd agents (api, app)',
    apply : function(ctx) {

        let written = agents.write(agents.getAgents(ctx.settings, ctx.paths))

        return { detail : written.length ? 'written ' + written.join(', ') : 'current', ok : true }

    },
    check : function(ctx) {

        let list = agents.getAgents(ctx.settings, ctx.paths)

        return agents.getCurrent(list) ? { detail : list.map(function(agent) { return agent.label }).join(', '), ok : true } : { detail : 'write ' + list.map(function(agent) { return agent.file }).join(', '), ok : false }

    }
}
