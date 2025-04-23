import { log, throttle_and_retry } from "mentie"
import fetch from "node-fetch"
const { CI_MODE } = process.env

// This hardcoded validator list is temporary and will be replaced by a metagrah query
const validators = [

    // Live validators as on https://taostats.io/subnets/65/metagraph?order=stake%3Adesc
    { uid: 0, ip: '185.189.44.166' },
    { uid: 4, ip: '185.141.218.102' },
    { uid: 61, ip: '0.0.0.0' },
    { uid: 12, ip: '0.0.0.0' },
    { uid: 117, ip: '34.130.136.222' },
    { uid: 1, ip: '0.0.0.0' },
    { uid: 212, ip: '192.150.253.122' },
    { uid: 186, ip: '161.35.91.172' },
    { uid: 101, ip: '0.0.0.0' },
    { uid: 11, ip: '152.53.236.231' },

    // Testnet validators
    { uid: null, ip: '165.232.93.107' },
    { uid: null, ip: '159.223.6.225' }


]

export function validator_count() {
    // Remove testnet validators and return count
    return validators.filter( ( { uid } ) => !!uid ).length
}

export function validator_ips() {
    
    // Remove testnet validators aand 0.0.0.0 entries
    const ips = validators.filter( ( { uid, ip } ) => uid !== null && ip != '0.0.0.0' ).map( ( { ip } ) => ip )
    return ips
}

export function is_validator( request ) {

    // In CI mode, bypass this check
    if( CI_MODE ) {
        log.info( `CI_MODE is enabled, bypassing validator check` )
        return { uid: Infinity, ip: 'mock.mock.mock.mock' }
    }

    // Get the ip of the originating request
    let { ip: request_ip, ips, connection, socket } = request
    let spoofable_ip = request_ip || ips[0] || request.get( 'x-forwarded-for' )
    let unspoofable_ip = connection.remoteAddress || socket.remoteAddress
    if( unspoofable_ip?.startsWith( '::ffff:' ) ) unspoofable_ip = unspoofable_ip?.replace( '::ffff:', '' )
    log.info( `Request ip: ${ unspoofable_ip } (spoofable: ${ spoofable_ip } )` )

    // Check if input is ipv4 (very naively)
    const is_ipv4 = unspoofable_ip.match( /\d*.\d*.\d*.\d*/ )
    if( !is_ipv4 ) return false


    // Find first matching validator
    const validator = validators.find( val => val.ip == unspoofable_ip )

    return validator

}

export async function broadcast_miner_ips( ip_addresses=[] ) {

    // Get validator ips
    log.info( `Broadcasting miner ips: `, ip_addresses )

    // Define the broadcast function
    async function broadcast( validator_ip ) {


        // Timeout controls
        const timeout_ms = 20_000
        const controller = new AbortController()
        const timeout = setTimeout( () => {
            controller.abort()
        }, timeout_ms )
        const { signal } = controller

        let response = undefined
        try {

            log.info( `Broadcasting to ${ validator_ip }` )

            // Call the validator
            response = await fetch( `http://${ validator_ip }:3000/protocol/broadcast/miner_ip`, {
                signal,
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify( { ip_addresses } )
            } )

            // Get json
            const json = await response?.clone().json()
            log.info( `Response from ${ validator_ip }:`, json )
            return json

        } catch ( e ) {
            const text_response = await response?.clone().text().catch( e => e.message )
            log.warn( `Error broadcasting to ${ validator_ip } with ${ e.message }: `, text_response )
            return { error: e.message, validator_ip }
        } finally {
            // Clear the timeout
            clearTimeout( timeout )
        }

    }

    // Broadcast to all validators
    try {

        const broadcast_calls = validator_ips().map( ip => async () => broadcast( ip ) )
        const results = await throttle_and_retry( broadcast_calls, {
            max_parallell: 10,
            cooldown_in_s: 5,
            retry_times: 3
        } )
        log.info( `Broadcast results:`, results )
        return results

    } catch ( e ) {
        log.error( `Error broadcasting to validators:`, e )
        return { error: e.message }
    }


}