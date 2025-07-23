// Dependencies
import { cache, log } from "mentie"

// Get relevant environment data
import { get_git_branch_and_hash, check_system_warnings } from './modules/system/shell.js'
import { readFile } from 'fs/promises'
const { version } = JSON.parse( await readFile( new URL( './package.json', import.meta.url ) ) )
const { branch, hash } = await get_git_branch_and_hash()
const { RUN_MODE } = process.env
const last_start = cache( 'last_start', new Date().toISOString() )

/* ///////////////////////////////
// System setup
// /////////////////////////////*/

// Boot up message
log.info( `${ last_start } - Starting TPN ${ RUN_MODE } component version ${ version } (${ branch }/${ hash })` )

// Check system resources
await check_system_warnings()

// Import express
import { app } from './modules/networking/server.js'
import { base_url } from "./modules/networking/url.js"

// Root route responds with identity
import { router as index_router } from './routes/index.js'
app.use( '/', index_router )

/* ///////////////////////////////
// Routes
// /////////////////////////////*/

// Protocol routes
import { router as protocol_router } from './routes/protocol/neurons.js'
import { router as stats_router } from './routes/protocol/stats.js'
app.use( '/protocol', protocol_router )
app.use( '/protocol', stats_router )

/* ///////////////////////////////
// Start server
// /////////////////////////////*/
const server = app.listen( 3000, () => {
    console.log( `Server running, serving from base url ${ base_url }` )
} )

// Handle graceful shutdown
import { handle_exit_gracefully } from './modules/system/process.js'
handle_exit_gracefully( server )