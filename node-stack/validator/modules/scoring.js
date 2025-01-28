import { log } from 'mentie'
import { save_ip_address } from './database.js'
import { is_data_center } from './ip2location.js'

/**
 * Scores the uniqueness of a request based on its IP address.
 *
 * @param {Object} request - The request object.
 * @param {string} request.ip - The IP address of the request.
 * @param {string[]} request.ips - The array of IP addresses in  the request.
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
    const geoip = await import( 'geoip-lite' )
    const { country='unknown' } = geoip.lookup( unspoofable_ip ) || {}
    log.info( `Request from:`, country )
    
    // Get the connection type and save ip to db
    const [ is_dc, { ip_pct_same_country } ] = await Promise.all( [
        is_data_center( unspoofable_ip ),
        save_ip_address( { ip_address: unspoofable_ip, country } )
    ] )
    
    // Calcluate the score of the request, datacenters get half scores
    const country_uniqueness_score = ( 100 - ip_pct_same_country ) * ( is_dc ? 0.5 : 1 )
    log.info( `Country uniqueness: ${ country_uniqueness_score }` )


    // Return the score of the request
    return country_uniqueness_score

}
// Datacenter name patterns (including educated guesses)
export const datacenter_patterns = [
    /amazon/i,
    /aws/i,
    /cloudfront/i,
    /google/i,
    /microsoft/i,
    /azure/i,
    /digitalocean/i,
    /linode/i,
    /vultr/i,
    /ovh/i,
    /hetzner/i,
    /upcloud/i,
    /scaleway/i,
    /contabo/i,
    /ionos/i,
    /rackspace/i,
    /softlayer/i,
    /alibaba/i,
    /tencent/i,
    /baidu/i,
    /cloudflare/i,
    /fastly/i,
    /akamai/i,
    /edgecast/i,
    /level3/i,
    /limelight/i,
    /incapsula/i,
    /stackpath/i,
    /maxcdn/i,
    /cloudsigma/i,
    /quadranet/i,
    /psychz/i,
    /choopa/i,
    /leaseweb/i,
    /hostwinds/i,
    /equinix/i,
    /colocrossing/i,
    /hivelocity/i,
    /godaddy/i,
    /bluehost/i,
    /hostgator/i,
    /dreamhost/i,
    /hurricane electric/i,
    // Generic patterns indicating data centers
    /colo/i,
    /datacenter/i,
    /serverfarm/i,
    /hosting/i,
    /cloud\s*services?/i,
    /dedicated\s*server/i,
    /vps/i
]