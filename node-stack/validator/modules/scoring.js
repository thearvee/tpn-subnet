import { log } from 'mentie'
import geoip from 'geoip-lite'
import { save_ip_address } from './database.js'

/**
 * Scores the uniqueness of a request based on its IP address.
 *
 * @param {Object} request - The request object.
 * @param {string} request.ip - The IP address of the request.
 * @param {string[]} request.ips - The array of IP addresses in the request.
 * @param {Object} request.connection - The connection object of the request.
 * @param {Object} request.socket - The socket object of the request.
 * @param {Function} request.get - Function to get headers from the request.
 * @returns {Promise<number>} - The uniqueness score [0-100] of the request based on the country of the IP address.
 */
export async function score_request_uniqueness( request ) {

    // Get the ip of the originating request
    let { ip: request_ip, ips, connection, socket } = request
    let spoofable_ip = request_ip || ips[0] || request.get( 'x-forwarded-for' )
    let unspoofable_ip = connection.remoteAddress || socket.remoteAddress

    // Log out the ip address of the request
    if( unspoofable_ip ) log.info( `Request from ${ unspoofable_ip }` )
    if( !unspoofable_ip ) log.info( `Cannot determine ip address of request, but it might be coming from ${ spoofable_ip } based on headers alone` )

    // Get the geolocation of this ip
    const { country='unknown' } = geoip.lookup( unspoofable_ip ) || {}
    log.info( `Request from:`, country )

    // Save the ip address to the database
    const { ip_pct_same_country } = await save_ip_address( { ip_address: unspoofable_ip, country } )
    const country_uniqueness_score = 100 - ip_pct_same_country
    log.info( `Country uniqueness: ${ country_uniqueness_score }` )

    // Return the score of the request
    return country_uniqueness_score

}