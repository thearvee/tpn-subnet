import { cache, log, wait } from "mentie"
const { CI_MODE } = process.env

const get_validators = async () => {

    // Get validators from cache
    let validators = cache( 'last_known_validators' )
    let attempts = 0

    while( !validators?.length && attempts < 5 ) {
        await wait( 5000 )
        validators = cache( 'last_known_validators' )
        attempts++
    }

    // Throw error if no validators
    if( !validators?.length ) {
        log.error( `No validators found in cache` )
        throw new Error( `No validators found in cache, this means something is wrong in the neuron` )
    }

    return validators

}

export async function validator_count() {

    // Remove testnet validators and return count
    const validators = await get_validators()
    return validators.filter( ( { uid } ) => !!uid ).length
    
}

export async function validator_ips() {
    
    // Remove testnet validators aand 0.0.0.0 entries
    const validators = await get_validators()
    const ips = validators.filter( ( { uid, ip } ) => uid !== null && ip != '0.0.0.0' ).map( ( { ip } ) => ip )
    return ips

}

export async function is_validator( request ) {

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
    const validators = await get_validators()
    const validator = validators.find( val => val.ip == unspoofable_ip )

    return validator

}
