import { exec } from 'child_process'
import { log } from 'mentie'

export async function run( command, silent=false, verbose=false ) {

    return new Promise( ( resolve ) => {

        if( !silent ) log.info( `exec:`, command )
        exec( command, ( error, stdout, stderr ) => {

            // If silent, just resolve with data
            if( silent ) return resolve( { error, stdout, stderr } )

            // Log the output
            if( stdout ) log.info( `stdout:`, stdout.trim?.() || stdout )
            if( stderr ) log.warn( `stderr:`, stderr.trim?.() || stderr )
            if( error && verbose ) log.warn( `error:`, error.trim?.() || error )
            if( error ) log.info( `Error running ${ command }:` )


            // Resolve with data
            resolve( { error, stdout, stderr } )

        } )

    } )

}