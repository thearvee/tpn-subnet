import { is_ipv4, log, require_props, sanetise_string } from "mentie"
import { country_name_from_code } from "./geolocation/helpers.js"

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
    let valid_country = country_name_from_code( country_code )
    if( CI_MODE && typeof country_code === 'string' && country_code.length > 0 ) valid_country = true
    if( !valid_country ) {
        log.info( `Worker country code is not valid: ${ country_code }` )
        return false
    }

    return true

}

/**
 * Gets the current run mode and its associated flags.
 * @returns {Object<{ run_mode: string, worker_mode: boolean, miner_mode: boolean, validator_mode: boolean }>} - An object containing the run mode and its flags.
 */
export const run_mode = () => {
    const { RUN_MODE } = process.env
    const mode = sanetise_string( RUN_MODE )
    if( ![ 'validator', 'miner', 'worker' ].includes( RUN_MODE ) ) throw new Error( `Invalid run mode: ${ RUN_MODE }` )
    return {
        mode,
        worker_mode: mode == 'worker',
        miner_mode: mode == 'miner',
        validator_mode: mode == 'validator',
    }
}