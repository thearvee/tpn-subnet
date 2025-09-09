import { is_ipv4, log, wait } from "mentie"
import { ip_from_req } from "./network.js"
import { get_tpn_cache } from "../caching.js"
const { CI_MODE, CI_VALIDATOR_IP_OVERRIDES } = process.env

// This hardcoded validator list is a failover for when the neuron did not submit the latest validator ips
export const validators_ip_fallback = [

    // Live validators as on https://taostats.io/subnets/65/metagraph?order=stake%3Adesc
    { uid: 117, ip: '34.130.136.222' },
    { uid: 4, ip: '88.204.136.220' },
    { uid: 0, ip: '88.204.136.221' },
    { uid: 47, ip: '161.35.91.172' },
    { uid: 212, ip: '192.150.253.122' },

]

// Manual override for ips that should be considered validators for the purpose of miner API requests
export const validators_ip_overrides = [ ...CI_VALIDATOR_IP_OVERRIDES ? CI_VALIDATOR_IP_OVERRIDES.split( ',' ) : [], '88.204.136.221', '88.204.136.220', '161.35.91.172' ]


export const get_validators = async () => {

    // Get validators from cache
    let validators = get_tpn_cache( 'last_known_validators' )
    let attempts = 0

    while( !validators?.length && attempts < 5 ) {
        log.info( `[ WHILE ] No validators found in cache, waiting 5 seconds and retrying...` )
        await wait( 5_000 )
        validators = get_tpn_cache( 'last_known_validators' )
        attempts++
    }

    // Return fallback validators if no validators found in cache
    if( !validators?.length ) {
        log.error( `No validators found in cache` )
        return validators_ip_fallback
    }

    // For all validators to use, check that their ip is not 0.0.0.0, if it is override with hardcoded list above
    for( const validator of validators ) {
        if( validator.ip == '0.0.0.0' ) {
            log.warn( `Validator ${ validator.uid } has ip 0.0.0.0, using hardcoded list instead` )
            validator.ip = validators_ip_fallback.find( val => val.uid == validator.uid )?.ip || '0.0.0.0'
        }
    }

    return validators

}

/**
 * Checks if request came from known validator ip
 * @param {Object} request - The request object
 * @returns {Promise<{ uid: number, ip: string }>} An object containing the validator's uid and ip address.
 * @description Checks if the request is from a validator by matching
 */
export async function is_validator_request( request ) {

    // In CI mode, bypass this check
    if( CI_MODE ) {
        log.info( `CI_MODE is enabled, bypassing validator check` )
        return { uid: 99999, ip: 'mock.mock.mock.mock' }
    }

    // Get the ip of the originating request
    const { unspoofable_ip, spoofable_ip } = ip_from_req( request )
    log.info( `Request ip: ${ unspoofable_ip } (spoofable: ${ spoofable_ip } )` )

    // Check if input is ipv4
    if( !is_ipv4( unspoofable_ip ) ) return false


    // Find first matching validator
    const validators = await get_validators()
    const validator = validators.find( val => val.ip == unspoofable_ip )
    if( validator ) return validator

    // Check if ip is override ip
    if( validators_ip_overrides.includes( unspoofable_ip ) ) {
        log.info( `Request ip ${ unspoofable_ip } is an override ip` )
        return { uid: Infinity, ip: unspoofable_ip }
    }

    // If no validator found, return false
    return {}

}
