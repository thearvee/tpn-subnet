import { log, wait } from "mentie"
import { ip_from_req } from "./network.js"
import { get_tpn_cache } from "./caching.js"
const { CI_MODE } = process.env

const get_validators = async () => {

    // Get validators from cache
    let validators = get_tpn_cache( 'last_known_validators' )
    let attempts = 0

    while( !validators?.length && attempts < 5 ) {
        await wait( 5000 )
        validators = get_tpn_cache( 'last_known_validators' )
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
    const { unspoofable_ip, spoofable_ip } = ip_from_req( request )
    log.info( `Request ip: ${ unspoofable_ip } (spoofable: ${ spoofable_ip } )` )

    // Check if input is ipv4 (very naively)
    const is_ipv4 = unspoofable_ip.match( /\d*.\d*.\d*.\d*/ )
    if( !is_ipv4 ) return false


    // Find first matching validator
    const validators = await get_validators()
    const validator = validators.find( val => val.ip == unspoofable_ip )

    return validator

}
