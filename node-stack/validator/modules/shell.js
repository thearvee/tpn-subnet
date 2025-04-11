import { exec } from 'child_process'
import { log } from 'mentie'


/**
 * Executes a shell command asynchronously and logs the output based on the provided options.
 *
 * @param {string} command - The shell command to execute.
 * @param {Object} [options={}] - Options to control the execution and logging behavior.
 * @param {boolean} [options.silent=false] - If true, suppresses all logging.
 * @param {boolean} [options.verbose=false] - If true, logs detailed output including errors, stdout, and stderr.
 * @param {string} [options.log_tag=`[ ${Date.now()} ] `] - A custom log tag to prefix log messages.
 * @returns {Promise<Object>} A promise that resolves with an object containing:
 *   - `error` (Error|null): The error object if the command fails, or null if no error occurred.
 *   - `stdout` (string|null): The standard output of the command, or null if empty.
 *   - `stderr` (string|null): The standard error output of the command, or null if empty.
 */
export async function run( command, { silent=false, verbose=false, log_tag=`[ ${ Date.now() } ] ` }={} ) {

    return new Promise( ( resolve ) => {


        if( !silent ) log.info( log_tag, `exec:`, command )
        exec( command, ( error, stdout, stderr ) => {

            if( !stderr?.length ) stderr = null
            if( !stdout?.length ) stdout = null

            // If silent, just resolve with data
            if( silent ) return resolve( { error, stdout, stderr } )
            
            // If verbose, log all
            if( verbose ) log.info( log_tag, { error, stdout, stderr } )

            // Log the output
            if( stdout ) log.info( log_tag, `stdout:`, stdout.trim?.() || stdout )
            if( stderr ) log.warn( log_tag, `stderr:`, stderr.trim?.() || stderr )
            if( error && verbose ) log.warn( log_tag, `error:`, error.trim?.() || error )
            if( error ) log.info( log_tag, `Error running ${ command }:`, error )


            // Resolve with data
            resolve( { error, stdout, stderr } )

        } )

    } )

}