import { log } from "mentie"
import { close_pool } from "../database/postgres.js"

export function handle_exit_gracefully( server ) {

    const handle_close = async reason => {
        log.info( 'Closing server, reason: ', reason || 'unknown' )
        log.info( 'Shutting down gracefully...' )
        server.close()
        await close_pool()
        process.exit( 0 )
    }

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

}