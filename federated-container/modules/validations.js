import { is_ipv4, log, require_props } from "mentie"
import { get_tpn_cache } from "./caching.js"

const { CI_MODE } = process.env

/**
 * Validates if a worker object has the required properties and a valid IPv4 address.
 * @param {Object} worker - The worker object to validate.
 * @returns {boolean} - Returns true if the worker is valid, otherwise false.
 */
export const is_valid_worker = ( worker ) => {

    if( !worker || typeof worker !== 'object' ) return false
    const { ip, country_code } = worker

    const has_required_props = require_props( worker, [ 'ip', 'country_code' ], false )
    if( !has_required_props ) {
        log.info( `Worker object is missing required properties:`, worker )
        return false
    }
    
    const valid_ip = is_ipv4( ip )
    if( !valid_ip ) {
        log.info( `Worker IP is not a valid IPv4 address: ${ ip }` )
        return false
    }

    // Check if country code is valid
    const miner_country_code_to_name = get_tpn_cache( 'miner_country_code_to_name', {} )
    let valid_country = miner_country_code_to_name[ country_code ] !== undefined
    if( CI_MODE && typeof country_code === 'string' && country_code.length > 0 ) valid_country = true
    if( !valid_country ) {
        log.info( `Worker country code is not valid: ${ country_code }` )
        return false
    }

    return true

}