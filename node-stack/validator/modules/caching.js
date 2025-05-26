import { cache, log } from "mentie"

/**
 * Retrieves a value from the in-memory cache using the provided key.
 *
 * ## Known cache keys and formats:
 *
 * ### Miner-related:
 * - `"miner_ip_to_country"`: `{ String: { country: String, uid: String } }`  
 *   Map of IP addresses to country codes and UIDs.
 *
 * - `"miner_country_count"`: `{ String: Number }`  
 *   Map of country codes to miner counts.
 *
 * - `"miner_country_to_ips"`: `{ String: String[] }`  
 *   Map of country codes to arrays of miner IPs.
 *
 * - `"miner_country_to_uids"`: `{ String: String[] }`  
 *   Map of country codes to arrays of miner UIDs.
 *
 * - `"miner_country_code_to_name"`: `{ String: String }`  
 *   ISO country code to human-readable name mapping.
 *
 * - `"miner_country_name_to_code"`: `{ String: String }`  
 *   Country name to ISO code mapping.
 *
 * - `"miner_uids"`: `String[]`  
 *   List of all known miner UIDs.
 *
 * - `"last_known_miner_scores"`:  
 *   `{ String: { score: Number, timestamp: Number, details: any, country: String, ip: String } }`  
 *   Map of miner UID to most recent score metadata.
 *
 * ### Validator-related:
 * - `"last_known_validators"`: `{ uid: String, ip: String }[]`  
 *   List of validator IPs submitted by the neuron.
 *
 * ### Challenge-related (dynamic keys):
 * - `"challenge_solution_${challenge}"`: `{ response: String, [extra]: any }`  
 *   Cached solution for a challenge string.
 *
 * - `"solution_score_${challenge}"`:  
 *   `{ correct: Boolean, score: Number, speed_score: Number, uniqueness_score: Number, country_uniqueness_score: Number, solved_at: Number, miner_uid: String }`  
 *   Cached score results for a challenge solution.
 *
 * ### IP2Location-related:
 * - `"is_dc_${ip_address}"`: `Boolean`  
 *   Whether the given IP address is identified as being in a datacenter (cached for 5 minutes).
 *
 * @param {string} key - The key to retrieve the cached value for.
 * @param {any} [default_value=undefined] - The default value to return if the key is not found in the cache.
 * @returns {any} - The cached value associated with the key, or undefined if not found.
 */
export function get_tpn_cache( key, default_value=undefined ) {

    // Log the cache lookup
    log.info( `Retrieving cache for key: ${ key }` )

    // Get cache value
    const cache_value = cache( key )

    // If no value, return the default value
    if( !cache_value ) return default_value

    // If the cache value is one the is tracked by reference, make a new version of it
    let immutable_cache_value = cache_value
    if( typeof cache_value == 'object' ) immutable_cache_value = { ...cache_value }
    if( Array.isArray( cache_value ) ) immutable_cache_value = [ ...cache_value ]

    // Return cached value or undefined
    return immutable_cache_value
}

/**
 * Retrieves all cached values related to the TPN
 * @returns {Object} An object containing all cached values related to the TPN.
 */
export function get_complete_tpn_cache() {

    // List of all cache keys of get_tpn_cache
    const keys = [
        'miner_ip_to_country',
        'miner_country_count',
        'miner_country_to_ips',
        'miner_country_to_uids',
        'miner_country_code_to_name',
        'miner_country_name_to_code',
        'miner_uids',
        'last_known_miner_scores',
        'last_known_validators'
    ]

    // Get all cache values
    const cache_values = {}
    for( const key of keys ) {
        cache_values[ key ] = get_tpn_cache( key )
    }

    // Return all cache values
    return cache_values

}