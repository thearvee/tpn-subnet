import { log } from 'mentie'
import { save_ip_address_and_return_ip_stats } from './database.js'
import { is_data_center } from './ip2location.js'
const { CI_MODE } = process.env

export const ip_from_req = ( request ) => {
    let { ip: request_ip, ips, connection, socket } = request
    let spoofable_ip = request_ip || ips[0] || request.get( 'x-forwarded-for' )
    let unspoofable_ip = connection.remoteAddress || socket.remoteAddress
    return { unspoofable_ip, spoofable_ip }
}

/**
 * Scores the uniqueness of a request based on its IP address.
 *
 * @param {Object} request - The request object.
 * @param {string} request.ip - The IP address of the request.
 * @param {string[]} request.ips - The array of IP addresses in  the request.
 * @param {Object} request.connection - The connection object of the request.
 * @param {Object} request.socket - The socket object of the request.
 * @param {Function} request.get - Function to get headers from the request.
 * @param {Object} options - Options for the function.
 * @param {boolean} [options.save_ip=true] - Whether to save the IP address to the database.
 * @returns {Promise<Object|undefined>} - Returns an object containing the uniqueness score and country uniqueness score if successful, otherwise undefined.
 */
export async function score_request_uniqueness( request, { save_ip=false }={} ) {

    // Get the ip of the originating request
    let { unspoofable_ip, spoofable_ip } = ip_from_req( request )

    // Sanetise potential ipv6 mapping of ipv4 address
    if( unspoofable_ip?.startsWith( '::ffff:' ) ) unspoofable_ip = unspoofable_ip?.replace( '::ffff:', '' )

    // Log out the ip address of the request
    if( unspoofable_ip ) log.info( `Request from ${ unspoofable_ip }` )
    if( !unspoofable_ip ) {
        log.info( `Cannot determine ip address of request, but it might be coming from ${ spoofable_ip } based on headers alone` )
        // return undefined so the calling parent knows there is an issue
        return { uniqueness_score: undefined }
    }

    // Get the geolocation of this ip
    const { default: geoip } = await import( 'geoip-lite' )
    const { country } = geoip.lookup( unspoofable_ip ) || {}
    log.info( `Request from:`, country )

    // If country was undefined, exit with undefined score
    if( !country && !CI_MODE ) {
        log.info( `Cannot determine country of request` )
        return { uniqueness_score: undefined }
    }

    // Get the connection type and save ip to db
    const [ is_dc, { ip_pct_same_country=0, country_count=0, ip_count, ips_in_same_country } ] = await Promise.all( [
        is_data_center( unspoofable_ip ),
        save_ip_address_and_return_ip_stats( { ip_address: unspoofable_ip, country, save_ip } )
    ] )
    log.info( `Call stats: `, { is_dc, ip_pct_same_country, country_count, ip_count } )
    
    // Calcluate the score of the request, datacenters get half scores
    const datacenter_penalty = 0.9
    let country_uniqueness_score = ( 100 - ip_pct_same_country ) * ( is_dc ? datacenter_penalty : 1 )
    if( country_count == 1 ) {
        log.info( `There is only one country in the database, force-setting country uniqueness to 100, details: `, { country_count, ip_count, ip_pct_same_country } )
        country_uniqueness_score = 100
    }
    log.info( `Country uniqueness: ${ country_uniqueness_score }` )

    // Curve score with a power function where 100 stays 100, but lower numbers get more extreme
    const curve = 5
    const powered_score = Math.pow( country_uniqueness_score / 100, curve ) * 100
    log.info( `Powered score: ${ powered_score }` )

    // Return the score of the request
    return { uniqueness_score: powered_score, country_uniqueness_score, details: {
        is_dc,
        ip_pct_same_country,
        country_count,
        ip_count,
        ips_in_same_country
    } }

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