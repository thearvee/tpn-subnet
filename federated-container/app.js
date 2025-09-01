// Dependencies
import { cache, log } from "mentie"

// Get relevant environment data
import { get_git_branch_and_hash, check_system_warnings } from './modules/system/shell.js'
import { run_mode } from "./modules/validations.js"
import { readFile } from 'fs/promises'
const { version } = JSON.parse( await readFile( new URL( './package.json', import.meta.url ) ) )
const { branch, hash } = await get_git_branch_and_hash()
const { SERVER_PUBLIC_PORT } = process.env
const { mode, worker_mode, validator_mode, miner_mode } = run_mode()
const last_start = cache( 'last_start', new Date().toISOString() )

/* ///////////////////////////////
// System setup
// /////////////////////////////*/

// Boot up message
log.info( `${ last_start } - Starting TPN ${ mode } component version ${ version } (${ branch }/${ hash })` )

// Check system resources
await check_system_warnings()

// Initialize database
import { init_database } from './modules/database/init.js'
await init_database()

// Update geolocation databases
if( validator_mode || miner_mode ) {

    const { geolocation_update_interval_ms } = await import( './modules/geolocation/helpers.js' )
    const { update_maxmind } = await import( './modules/geolocation/maxmind.js' )
    const { update_ip2location_bin } = await import( './modules/geolocation/ip2location.js' )

    await Promise.allSettled( [
        update_maxmind(),
        update_ip2location_bin()
    ] )
    setInterval( update_maxmind, geolocation_update_interval_ms )
    setInterval( update_ip2location_bin, geolocation_update_interval_ms )
    log.info( `Geolocation databases updated and will be refreshed every ${ geolocation_update_interval_ms / 1000/ 60 / 60 } hours` )

    // On start, clear network
    const { clean_up_tpn_interfaces, clean_up_tpn_namespaces } = await import( "./modules/networking/wireguard.js" )
    await clean_up_tpn_interfaces()
    await clean_up_tpn_namespaces()

}


// Import express
import { app } from './modules/networking/server.js'
import { base_url } from "./modules/networking/url.js"

// Root route responds with identity
import { router as health_router } from './routes/health.js'
app.use( '/', health_router )

/* ///////////////////////////////
// Routes
// /////////////////////////////*/

// Protocol routes
if( validator_mode || miner_mode ) {

    const { router: protocol_router } =  await import( './routes/protocol/neurons.js' )
    const { router: stats_router } = await import( './routes/protocol/stats.js' )
    const { router: challenge_solution_router } = await import( './routes/protocol/challenge-response.js' )
    app.use( '/protocol', protocol_router )
    app.use( '/protocol', stats_router )
    app.use( '/protocol/challenge', challenge_solution_router )
    log.info( `Protocol routes registered` )

}

// Validator routes
if( validator_mode ) {

    const { router: validator_broadcast_router } = await import( './routes/validator/broadcast.js' )
    const { router: validator_force_scoring } = await import( './routes/validator/score.js' )
    app.use( '/validator/broadcast', validator_broadcast_router )
    app.use( '/validator/score', validator_force_scoring )
    log.info( `Validator routes registered` )

}

// API Routes
import { router as api_status_router } from './routes/api/status.js'
import { router as api_lease_router } from './routes/api/lease.js'
app.use( '/api/', api_status_router )
app.use( '/api/', api_lease_router )
log.info( `API routes registered` )

/* ///////////////////////////////
// Start server
// /////////////////////////////*/
const server = app.listen( SERVER_PUBLIC_PORT, () => {
    console.log( `Server running, serving from base url ${ base_url }` )
} )

// Handle graceful shutdown
import { handle_exit_gracefully } from './modules/system/process.js'
handle_exit_gracefully( server )
