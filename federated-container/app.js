// Dependencies
import { log } from "mentie"

// Get relevant environment data
import { get_git_branch_and_hash, check_system_warnings } from './modules/shell.js'
import { readFile } from 'fs/promises'
const { version } = JSON.parse( await readFile( new URL( './package.json', import.meta.url ) ) )
const { branch, hash } = await get_git_branch_and_hash()
const last_start = new Date().toISOString()
const { RUN_MODE } = process.env

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
app.get( '/', ( req, res ) => {
    return res.json( {
        notice: `I am a TPN Network ${ RUN_MODE } component running v${ version }`,
        info: 'https://tpn.taofu.xyz',
        version,
        last_start,
        branch,
        hash
    } )
} )

/* ///////////////////////////////
// Routes
// /////////////////////////////*/

// Protocol routes
import { router as protocol_router } from './routes/protocol.js'
app.use( '/protocol', protocol_router )

// Listen to requests
const server = app.listen( 3000, () => {
    console.log( `Server running, serving from base url ${ base_url }` )
} )
const handle_close = async reason => {
    log.info( 'Closing server, reason: ', reason || 'unknown' )
    log.info( 'Shutting down gracefully...' )
    server.close()
    // await close_pool()
    process.exit( 0 )
}

/* ///////////////////////////////
// Termination handling
// /////////////////////////////*/

// Handle shutdown signals
const shutdown_signals = [ 'SIGTERM', 'SIGINT', 'SIGQUIT' ]
shutdown_signals.map( signal => {
    log.info( `Listening for ${ signal } signal to shut down gracefully...` )
    process.on( signal, async () => handle_close( signal ) )
} )

// Handle uncaught exceptions
process.on( 'uncaughtException', async ( err ) => {
    const now = new Date().toISOString()
    log.error( `${ now } - Uncaught exception:`, err.message, err.stack )
    await handle_close( 'uncaughtException' )
} )
process.on( 'unhandledRejection', async ( reason, promise ) => {
    const now = new Date().toISOString()
    log.error( `${ now } - Unhandled rejection at:`, promise, 'reason:', reason )
    await handle_close( 'unhandledRejection' )
} )