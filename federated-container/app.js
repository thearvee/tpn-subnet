// Dependencies
import { cache, log } from "mentie"

// Get relevant environment data
import { get_git_branch_and_hash, check_system_warnings } from './modules/system/shell.js'
import { readFile } from 'fs/promises'
const { version } = JSON.parse( await readFile( new URL( './package.json', import.meta.url ) ) )
const { branch, hash } = await get_git_branch_and_hash()
const { RUN_MODE, SERVER_PUBLIC_PORT } = process.env
const last_start = cache( 'last_start', new Date().toISOString() )

/* ///////////////////////////////
// System setup
// /////////////////////////////*/

// Boot up message
log.info( `${ last_start } - Starting TPN ${ RUN_MODE } component version ${ version } (${ branch }/${ hash })` )

// Check system resources
await check_system_warnings()

// Initialize database
import { init_database } from './modules/database/init.js'
await init_database()

// Update geolocation databases
import { geolocation_update_interval_ms } from './modules/geolocation/helpers.js'
import { update_maxmind } from './modules/geolocation/maxmind.js'
import { update_ip2location_bin } from './modules/geolocation/ip2location.js'
await Promise.allSettled( [
    update_maxmind(),
    update_ip2location_bin()
] )
setInterval( update_maxmind, geolocation_update_interval_ms )
setInterval( update_ip2location_bin, geolocation_update_interval_ms )
log.info( `Geolocation databases updated and will be refreshed every ${ geolocation_update_interval_ms / 1000/ 60 / 60 } hours` )


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
import { router as protocol_router } from './routes/protocol/neurons.js'
import { router as stats_router } from './routes/protocol/stats.js'
app.use( '/protocol', protocol_router )
app.use( '/protocol', stats_router )

// Validator routes
import { router as validator_broadcast_router } from './routes/validator/broadcast.js'
app.use( '/validator/broadcast', validator_broadcast_router )

/* ///////////////////////////////
// Start server
// /////////////////////////////*/
const server = app.listen( SERVER_PUBLIC_PORT, () => {
    console.log( `Server running, serving from base url ${ base_url }` )
} )

// Handle graceful shutdown
import { handle_exit_gracefully } from './modules/system/process.js'
handle_exit_gracefully( server )