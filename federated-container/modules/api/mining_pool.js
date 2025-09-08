import { is_ipv4, log, shuffle_array } from "mentie"
import { get_tpn_cache } from "../caching.js"
import { get_wireguard_config_directly_from_worker } from "../networking/worker.js"
const { CI_MOCK_WORKER_RESPONSES } = process.env

export async function get_worker_config_as_miner( { geo, format, whitelist, blacklist, lease_seconds } ) {

    // Get relevant workers
    const workers_by_country = get_tpn_cache( 'worker_country_code_to_ips', {} )
    let relevant_workers = workers_by_country[ geo ] || []
    if( blacklist?.length ) relevant_workers = relevant_workers.filter( ( { ip } ) => !blacklist.includes( ip ) )
    if( whitelist?.length ) relevant_workers = relevant_workers.filter( ( { ip } ) => whitelist.includes( ip ) )

    // If no workers, exit
    if( !CI_MOCK_WORKER_RESPONSES && !relevant_workers?.length ) {
        log.info( `No workers available for geo ${ geo } after applying whitelist(${ whitelist?.length })/blacklist(${ blacklist?.length })` )
        return null
    }

    // Shuffle the worker ip array
    shuffle_array( relevant_workers )

    // Get config from workers
    let config = null
    let attempts = 0
    while( !config && attempts < relevant_workers?.length ) {

        // Fetch config
        const worker = relevant_workers[ attempts ]
        attempts++
        if( !is_ipv4( worker.ip ) ) continue
        config = await get_wireguard_config_directly_from_worker( { worker, lease_seconds } )

    }

    // On mock succees
    if( CI_MOCK_WORKER_RESPONSES ) config = config || {}

    // Return the config
    return config

}