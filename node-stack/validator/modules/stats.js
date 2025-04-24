import { cache } from "mentie"

/**
 * Retrieves miner statistics from the cache or computes them if not available.
 * @returns {Promise<Object>} A promise that resolves to the miner statistics object.
 */
export async function get_miner_stats() {

    // Check for cached value
    const cache_key = 'miner_stats'
    const cached_value = cache( cache_key )
    if( cached_value ) return cached_value

    // Get last known miner country stats
    const miner_country_count = cache( `miner_country_count` ) || {}

    return cache( cache_key, miner_country_count, 60_000 )

}

/**
 * Retrieves a list of IPs associated with a specific country.
 *
 * @param {Object} [options={}] - The options object.
 * @param {string} [options.geo] - The country code (geo) to filter IPs by.
 * @returns {Promise<string[]>} A promise that resolves to an array of IPs for the specified country.
 */
export async function get_ips_by_country( { geo }={} ) {

    // Get the minet details from cache
    const miner_country_to_ips = cache( `miner_country_to_ips` ) || {}

    // Get the ips for this country
    const ips = miner_country_to_ips[ geo ] || []

    return ips

}