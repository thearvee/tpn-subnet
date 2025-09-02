import { abort_controller, is_ipv4, log, shuffle_array } from "mentie"
import { get_tpn_cache } from "../caching.js"
const { CI_MOCK_WORKER_RESPONSES } = process.env

export async function get_worker_config_as_miner( { geo, format, whitelist, blacklist, lease_seconds } ) {

    // Get relevant workers
    const workers_by_country = get_tpn_cache( 'worker_country_code_to_ips', {} )
    let relevant_ips = workers_by_country[ geo ] || []
    if( blacklist?.length ) relevant_ips = relevant_ips.filter( ip => !blacklist.includes( ip ) )
    if( whitelist?.length ) relevant_ips = relevant_ips.filter( ip => whitelist.includes( ip ) )

    // If no workers, exit
    if( !CI_MOCK_WORKER_RESPONSES && !relevant_ips?.length ) {
        log.info( `No workers available for geo ${ geo } after applying whitelist(${ whitelist?.length })/blacklist(${ blacklist?.length })` )
        return null
    }

    // Shuffle the worker ip array
    shuffle_array( relevant_ips )

    // Get config from workers
    let config = null
    let attempts = 0
    while( !config && attempts < relevant_ips?.length ) {

        // Fetch config
        const worker_ip = relevant_ips[ attempts ]
        attempts++
        if( !is_ipv4( worker_ip ) ) continue
        const query = `http://${ worker_ip }:3000/api/lease/new?lease_seconds=${ lease_seconds }&format=${ format }`
        const { fetch_options } = abort_controller( { timeout_ms: 2_000 } )
        config = fetch( query, fetch_options ).then( res => format === 'json' ? res.json() : res.text() )

    }

    // On mock succees
    if( CI_MOCK_WORKER_RESPONSES ) config = config || {}

    // Return the config
    return config

}