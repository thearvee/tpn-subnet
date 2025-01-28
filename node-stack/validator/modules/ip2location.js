import { IP2Location } from "ip2location-nodejs"
import fs from "fs"
import url from "url"
import https from "https"
import { log } from "mentie"
import unzipper from "unzipper"
import { datacenter_patterns } from "./scoring.js"

// Configurations
const __dirname = url.fileURLToPath( new URL( '.', import.meta.url ) )
const database_file_location = `${ __dirname }/../IP2LOCATION-LITE-ASN.IPV6.BIN`
const database_max_age_ms = 1000 * 60 * 60 * 24 * 2

// Init the IP2Location
const ip2location = new IP2Location()

/**
 * Unzips a .BIN file from a zip archive and extracts it to the specified output path.
 *
 * @param {string} zip_path - The path to the zip file.
 * @param {string} out_path - The path where the .BIN file should be extracted.
 * @returns {Promise<void>} A promise that resolves when the extraction is complete.
 * @throws {Error} If no .BIN file is found in the zip archive.
 */
async function unzip_bin( zip_path, out_path ) {

    // Read the zip file
    const directory = await unzipper.Open.file( zip_path )

    // Find the index of the .BIN file
    const bin_file = directory.files.find( file => file.path.endsWith( '.BIN' ) )
    if( !bin_file ) throw new Error( `No .BIN file found in the zip file ${ zip_path }` )
    
    // Extract the .BIN file to out path
    return new Promise( ( resolve, reject ) => {

        const out_stream = fs.createWriteStream( out_path )

        // Pipe the file to the out stream
        bin_file.stream().pipe( out_stream )

        // On finish, resolve
        out_stream.on( 'finish', () => {
            log.info( `Extracted the file ${ out_path }` )
            out_stream.close()
            resolve()
        } )

        // On error, reject
        out_stream.on( 'error', error => {
            log.error( `Error extracting the file ${ out_path }`, error )
            out_stream.close()
            reject( error )
        } ) 

    } )

}

/**
 * Downloads a file from a given URL and saves it to a specified path.
 * If the URL redirects, it follows the redirect and downloads the file from the new location.
 * If the content type of the response is 'text/html', it rejects with the page content.
 * After downloading, it unzips the file to a specified location.
 *
 * @param {string} url - The URL to download the file from.
 * @param {string} path - The path where the downloaded file will be saved.
 * @returns {Promise<void>} - A promise that resolves when the file is successfully downloaded and unzipped, or rejects with an error.
 */
async function download_url_to_file( url, path ) {

    const zip_path = `${ path }.zip`

    // Download the file
    log.info( `Downloading the file ${ path } from ${ url }` )
    return new Promise( ( resolve, reject ) => {

        // Get the file
        const download = https.get( url, response => {

            // Log response status
            log.info( `Response status: ${ response.statusCode }, content type: ${ response.headers[ 'content-type' ] }` )

            // If content type is text/html, make note
            let non_binary_response = false
            if( response.headers[ 'content-type' ].includes( 'text/html' ) ) {
                non_binary_response = true
                log.warn( `The ip2location response is not a binary file, this happens on frequent restarts and can be ignored so long as your ip2location file is up to date` )
            }

            // Check if the response is a redirect
            if( response.statusCode >= 300 && response.statusCode < 400 ) {
                const redirect_url = new URL( response.headers.location )
                log.info( `Redirecting to ${ redirect_url }` )
                // Recursively download the redirect
                return download_url_to_file( redirect_url, path ).then( resolve ).catch( reject )
            }

            // If the response is non binary, and we already have a zipfile, unzip it
            const zip_file_exists = fs.existsSync( zip_path )
            if( non_binary_response && zip_file_exists ) return unzip_bin( zip_path, database_file_location ).then( resolve ).catch( reject )
            if( non_binary_response && !zip_file_exists ) {
                log.warn( `The response is not a binary file, and we don't have a zip file to extract` )
                return resolve()
            }
            
            // Create file stream
            const file = fs.createWriteStream( path )

            // Pipe data to file
            response.pipe( file )

            // On file finish, close and resolve
            file.on( 'finish', () => {
                file.close()
                log.info( `Downloaded the file ${ path }` )

                // Unzip the file
                unzip_bin( zip_path, database_file_location ).then( resolve ).catch( reject )
                
            } )
        } )
        
        // Handle download failure
        download.on( 'error', error => {
            fs.unlink( path )
            log.error( `Error downloading the file ${ path }`, error )
            reject( error )
        } )
    } )

}

/**
 * Updates the IP2Location binary file by downloading the latest version if the current file is older than the maximum allowed age.
 * 
 * @async
 * @function update_ip2location_bin
 * @throws {Error} If the IP2LOCATION_DOWNLOAD_TOKEN environment variable is not set.
 */
export async function update_ip2location_bin() {

    const { IP2LOCATION_DOWNLOAD_TOKEN } = process.env
    if( !IP2LOCATION_DOWNLOAD_TOKEN ) throw new Error( 'IP2LOCATION_DOWNLOAD_TOKEN is not set' )

    // Download the ipv6 file which also contains ipv4 data
    const DATABASE_CODE = `DBASNLITEBINIPV6`
    const download_url = `https://www.ip2location.com/download/?token=${ IP2LOCATION_DOWNLOAD_TOKEN }&file=${ DATABASE_CODE }`

    // Download the file
    log.info( `Downloading the file ${ database_file_location } from ${ download_url }` )
    await download_url_to_file( download_url, database_file_location )

}

/**
 * Retrieves the connection type information for a given IP address.
 *
 * @param {string} ip_address - The IP address to lookup.
 * @returns {Promise<Object>} A promise that resolves to an object containing the connection type information.
 */
export async function is_data_center( ip_address ) {

    // Check that database file exists
    if( !fs.existsSync( database_file_location ) ) throw new Error( `Database file ${ database_file_location } does not exist` )

    // Get connection type
    await ip2location.openAsync( database_file_location )
    const automated_service_name = ip2location.getAS( ip_address )
    await ip2location.closeAsync()

    // Check against known datacenter providers
    const is_datacenter = datacenter_patterns.some( pattern => pattern.test( automated_service_name ) )
    log.info( `Retrieved connection type for IP address ${ ip_address } hosted by ${ automated_service_name }: ${ is_datacenter }` )
    return is_datacenter

}