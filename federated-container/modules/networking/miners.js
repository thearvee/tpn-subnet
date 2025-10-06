import { abort_controller, is_ipv4, log, make_retryable, wait } from "mentie"
import { ip_from_req } from "./network.js"
import { get_tpn_cache } from "../caching.js"
import { read_mining_pool_metadata } from "../database/mining_pools.js"
import { parse_wireguard_config } from "./wireguard.js"

const { CI_MODE, CI_MINER_IP_OVERRIDES } = process.env

// Manual override IPs to always treat as miner (mining pool) origins
export const miners_ip_overrides = CI_MINER_IP_OVERRIDES ? CI_MINER_IP_OVERRIDES.split( ',' ) || [] : []

/**
 * Returns a list of miners as { uid, ip } from the in-memory cache.
 * Waits briefly (with retries) if the cache hasn't been populated yet by the neuron broadcast.
 */
export const get_miners = async ( { ip_only=false, overrides_only=false, skip_overrides=false }={} ) => {

    // Build miner list from cache mapping of uid -> ip
    let miners = overrides_only ? [] : get_tpn_cache( 'last_known_miners', [] )
    let attempts = 0

    // Give the protocol broadcast a moment to populate cache on cold starts
    while( CI_MODE !== 'true' &&  !miners?.length && attempts < 5 ) {
        log.info( `[ WHILE ] No miners found in cache, waiting 5 seconds and retrying...` )
        await wait( 5_000 )
        miners = get_tpn_cache( 'last_known_miners', [] )
        attempts++
    }

    // Add ip overrides to validators
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

    // Extract the remote IP
    const { unspoofable_ip, spoofable_ip } = ip_from_req( request )
    log.info( `Request ip: ${ unspoofable_ip } (spoofable: ${ spoofable_ip } )` )

    if( !is_ipv4( unspoofable_ip ) ) {
        log.info( `Request IP is not a valid IPv4 address` )
        return {}
    }

    // Match against known miners from cache
    const miners = await get_miners()
    const miner = miners.find( m => m.ip === unspoofable_ip )
    if( miner ) return miner


    // In CI mode, bypass this check
    if( CI_MODE ) {
        log.info( `CI_MODE is enabled, bypassing miner check` )
        return { uid: 99999, ip: 'mock.mock.mock.mock' }
    }

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

/**
 * Validator function to get worker config through mining pool
 * @param {Object} params
 * @param {string} params.worker_ip - IP address of the worker
 * @param {string} params.mining_pool_uid - UID of the mining pool
 * @param {string} params.mining_pool_ip - IP address of the mining pool
 * @returns {Promise<Object>} - Promise resolving to the worker config
 */
export async function get_worker_config_through_mining_pool( { worker_ip, mining_pool_uid, mining_pool_ip, format='text', lease_seconds=120 } ) {

    try {

        // Get mining pool data
        const { protocol, url, port } = await read_mining_pool_metadata( { mining_pool_ip, mining_pool_uid } )
        if( !url?.includes( port ) || !url?.includes( protocol ) ) log.warn( `Mining pool URL ${ url } does not include port ${ port } or protocol ${ protocol }, this suggests misconfiguration of the miner` )
        const endpoint = `${ url }/api/lease/new`
        const query = `?lease_seconds=${ lease_seconds }&format=${ format }&whitelist=${ worker_ip }`

        // Mock response if needed
        const { CI_MOCK_MINING_POOL_RESPONSES } = process.env
        if( CI_MOCK_MINING_POOL_RESPONSES === 'true' ) {
            log.info( `CI_MOCK_MINING_POOL_RESPONSES is enabled, returning mock response for ${ endpoint }/${ query }` )
            return { json_config: { endpoint_ipv4: 'mock.mock.mock.mock' }, text_config: "" }
        }

        // Make retryable and cancellable request to mining pool for worker ip
        const timeout_ms = 10_000
        const { fetch_options } = abort_controller( { timeout_ms } )
        log.info( `Fetching worker config through mining pool at ${ endpoint }${ query }` )
        const fetch_function = async () => fetch( `${ endpoint }${ query }`, fetch_options ).then( res => res.text() )
        const retryable_fetch = await make_retryable( fetch_function, { retry_times: 2, cooldown_in_s: 2 } )
        const worker_config = await retryable_fetch()

        // Validate that the wireguard config is correct
        const { config_valid, json_config, text_config } = parse_wireguard_config( { wireguard_config: worker_config, expected_endpoint_ip: worker_ip } )
        if( !config_valid ) throw new Error( `Invalid wireguard config for ${ worker_ip }` )

        return format === 'json' ? json_config : text_config

    } catch ( e ) {
        log.info( `Error getting worker config for ${ worker_ip } through mining pool ${ mining_pool_ip }:`, e )
        return { error: e.message }
    }

}