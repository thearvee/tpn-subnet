// Set up environment
import 'dotenv/config'
const { CI_MODE } = process.env
import { log } from 'mentie'
const update_interval_ms = 1000 * 60 * 60 * 24 // 24 hours
import { readFile } from 'fs/promises'
const { version } = JSON.parse( await readFile( new URL( './package.json', import.meta.url ) ) )
const now = new Date().toISOString()
log.info( `${ now } - Starting Sybil Network validator component version ${ version }` )

// Check system resources
import { check_system_warnings } from './modules/shell.js'
await check_system_warnings()

// Initialize the database
import { init_tables } from './modules/database.js'
log.info( 'Initializing database' )
await init_tables()
log.info( 'Database initialized' )

// Update maxmind
import { update_maxmind } from './modules/update-maxmind.js'
log.info( 'Updating MaxMind database' )
if( !CI_MODE ) await update_maxmind().catch( e => log.error( e ) )
log.info( `Updating MaxMind database every ${ update_interval_ms / 1000 / 60 / 60 } hours` )
setInterval( update_maxmind, update_interval_ms )

// Update ip2location
import { update_ip2location_bin } from './modules/ip2location.js'
log.info( 'Updating ip2location database' )
await update_ip2location_bin().catch( e => log.error( e ) )
log.info( `Updating ip2location database every ${ update_interval_ms / 1000 / 60 / 60 } hours` )
setInterval( update_ip2location_bin, update_interval_ms )

// On restart, delete old interfaces
import { clean_up_tpn_interfaces, clean_up_tpn_namespaces } from './modules/wireguard.js'
await clean_up_tpn_interfaces()
await clean_up_tpn_namespaces()

// Import express
import { app } from './routes/server.js'

// Root route responds with identity
app.get( '/', ( req, res ) => {
    res.send( `I am a TPN Network validator component running v${ version }` )
} )

// Import and add scoring routes. This is a debugging route that is not actually used by the neurons
import { router as score_router } from './routes/score.js'
app.use( '/score', score_router )

// Import and add challenge routes
import { router as challenge_router } from './routes/challenge-response.js'
import { base_url } from './modules/url.js'
app.use( '/challenge', challenge_router )

// Import and add protocol routes
import { router as protocol_router } from './routes/protocol.js'
app.use( '/protocol', protocol_router )

// Import public api endpoint
import { router as api_router } from './routes/api.js'
app.use( '/api', api_router )

// Listen to requests
const server = app.listen( 3000, () => {
    console.log( `Server running, serving from base url ${ base_url }` )
} )
const handle_close = reason => {
    log.info( 'Closing server, reason: ', reason || 'unknown' )
    log.info( 'Shutting down gracefully...' )
    server.close()
    process.exit( 0 )
}

// Handle shutdown signals
const shutdown_signals = [ 'SIGTERM', 'SIGINT', 'SIGQUIT' ]
shutdown_signals.map( signal => {
    log.info( `Listening for ${ signal } signal to shut down gracefully...` )
    process.on( signal, () => handle_close( signal ) )
} )

// Handle uncaught exceptions
process.on( 'uncaughtException', ( err ) => {
    const now = new Date().toISOString()
    log.error( `${ now } - Uncaught exception:`, err.message, err.stack )
    handle_close( 'uncaughtException' )
} )
process.on( 'unhandledRejection', ( reason, promise ) => {
    const now = new Date().toISOString()
    log.error( `${ now } - Unhandled rejection at:`, promise, 'reason:', reason )
    handle_close( 'unhandledRejection' )
} )
