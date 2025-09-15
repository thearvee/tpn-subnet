import { is_ipv4, log, wait } from "mentie"
import { ip_from_req } from "./network.js"
import { get_tpn_cache } from "../caching.js"

const { CI_MODE, CI_MINER_IP_OVERRIDES } = process.env

// Manual override IPs to always treat as miner (mining pool) origins
export const miners_ip_overrides = CI_MINER_IP_OVERRIDES ? CI_MINER_IP_OVERRIDES.split( ',' ) || [] : []

/**
 * Returns a list of miners as { uid, ip } from the in-memory cache.
 * Waits briefly (with retries) if the cache hasn't been populated yet by the neuron broadcast.
 */
const get_miners = async ( { ip_only=false, overrides_only=false, skip_overrides=false } ) => {

    // Build miner list from cache mapping of uid -> ip
    let miners = overrides_only ? [] : get_tpn_cache( 'last_known_miners' )
    let attempts = 0

    // Give the protocol broadcast a moment to populate cache on cold starts
    while( CI_MODE !== 'true' && ( !miners || miners.length === 0 ) && attempts < 5 ) {
        log.info( `[ WHILE ] No miners found in cache, waiting 5 seconds and retrying...` )
        await wait( 5_000 )
        miners = get_tpn_cache( 'last_known_miners' )
        attempts++
    }

    // Add ip overrised to validators
    if( !skip_overrides ) miners = [ ...miners, ...miners_ip_overrides.map( ip => ( { uid: ip.replaceAll( '.', '' ), ip, override: true } ) ) ]

    // Filter out miners with an ip of 0.0.0.0
    miners = miners.filter( m => m.ip !== '0.0.0.0' )

    // If ip only, map
    if( ip_only ) miners = miners.map( m => m.ip )

    return miners
}

/**
 * Checks if request came from a known miner (mining pool) IP.
 * @param {Object} request - Express request object
 * @returns {Promise<{ uid: number, ip: string } | {}>} Matched miner identity or empty object.
 */
export async function is_miner_request( request ) {
    // In CI mode, bypass this check
    if( CI_MODE ) {
        log.info( `CI_MODE is enabled, bypassing miner check` )
        return { uid: 99999, ip: 'mock.mock.mock.mock' }
    }

    // Extract the remote IP
    const { unspoofable_ip, spoofable_ip } = ip_from_req( request )
    log.info( `Request ip: ${ unspoofable_ip } (spoofable: ${ spoofable_ip } )` )

    if( !is_ipv4( unspoofable_ip ) ) return {}

    // Match against known miners from cache
    const miners = await get_miners()
    const miner = miners.find( m => m.ip === unspoofable_ip )
    if( miner ) return miner

    // No match
    return {}
}

/**
 * Convenience: resolve a miner by UID using cache.
 */
export function get_miner_by_uid( uid ) {
    const uid_to_ip = get_tpn_cache( 'miner_uid_to_ip', {} )
    const ip = uid_to_ip?.[ uid ]
    return ip ? { uid: Number( uid ), ip } : {}
}

/**
 * Convenience: resolve a miner by IP using cache.
 */
export function get_miner_by_ip( ip ) {
    if( !is_ipv4( ip ) ) return {}
    const ip_to_uid = get_tpn_cache( 'miner_ip_to_uid', {} )
    const uid = ip_to_uid?.[ ip ]
    return uid ? { uid: Number( uid ), ip } : {}
}

