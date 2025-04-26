import { log } from "mentie"

// Check for license key
const { MAXMIND_LICENSE_KEY } = process.env
if( !MAXMIND_LICENSE_KEY ) {
    log.error( 'MAXMIND_LICENSE_KEY is required' )
}

import { spawn } from 'child_process'

// Spawn a child process that runs "npm run-script updatedb license_key=YOUR_LICENSE_KEY"
// in the "node_modules/geoip-lite" directory.
import url from 'url'
import { get_timestamp, set_timestamp } from "./database.js"
const __dirname = url.fileURLToPath( new URL( '.', import.meta.url ) )


/**
 * Updates the MaxMind GeoIP database by running the `updatedb` npm script.
 * @returns {Promise<string>} A promise that resolves with a success message when the update is complete, or rejects with an error message if the update fails.
 */
export async function update_maxmind() {

    // Check if we should update based on timestamp
    const update_min_interval_ms = 1000 * 60 * 60 * .5 // 30 minutes
    const last_update = await get_timestamp( { label: 'last_maxmind_update' } )
    const now = Date.now()
    const time_since_last_update = now - last_update
    if( time_since_last_update < update_min_interval_ms ) {
        log.info( `Maxmind database update age is below minimum interval of ${ update_min_interval_ms / 1000 / 60 } minutes` )
        return 'Maxmind database is up to date'
    }
    log.info( `Database age is ${ ( now - last_update ) / 1000 / 60 } minutes` )

    return new Promise( ( resolve, reject ) => {

        const updateProcess = spawn( 'npm', [ 'run-script', 'updatedb', `license_key=${ MAXMIND_LICENSE_KEY }` ], {
            cwd: `${ __dirname }/../node_modules/geoip-lite`, // run in the geoip-lite directory
            shell: true // use shell for command
        } )
        
        // Listen for output from stdout
        updateProcess.stdout.on( 'data', ( data ) => {
            log.info( `Maxmind update progress:`, data.toString() )
        } )
        
        // Listen for errors on stderr
        updateProcess.stderr.on( 'data', ( data ) => {
            log.error( `Maxmind update error:`, data.toString() )
            reject( data.toString() )
        } )
        
        // Fires when the process exits
        updateProcess.on( 'close', ( code ) => {
            log.info( `Maxmind update complete:`, code )
            set_timestamp( { label: 'last_maxmind_update', timestamp: Date.now() } ).then( () => {
                resolve( `Maxmind database update complete` )
            } )
        } )

    } )

}