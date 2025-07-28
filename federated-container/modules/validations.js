import { is_ipv4, require_props } from "mentie"
import { get_tpn_cache } from "./caching.js"

/**
 * Validates if a worker object has the required properties and a valid IPv4 address.
 * @param {Object} worker - The worker object to validate.
 * @returns {boolean} - Returns true if the worker is valid, otherwise false.
 */
export const is_valid_worker = ( worker ) => {

    if( !worker || typeof worker !== 'object' ) return false
    
    const has_required_props = require_props( worker, [ 'ip', 'country_code' ] )
    if( !has_required_props ) return false
    
    const valid_ip = is_ipv4( worker.ip )
    if( !valid_ip ) return false

    // Check if country code is valid
    const miner_country_code_to_name = get_tpn_cache( 'miner_country_code_to_name', {} )
    const valid_country = miner_country_code_to_name[ worker.country_code ] !== undefined
    if( !valid_country ) return false

    return true

}