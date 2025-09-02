import { log, shuffle_array } from "mentie"
import { get_tpn_cache } from "../caching.js"
import { get_worker_countries_for_pool, get_workers, read_worker_broadcast_metadata } from "../database/workers.js"
import { cochrane_sample_size } from "../math/samples.js"
import { get_worker_config_through_mining_pool } from "./score_workers.js"
import { test_wireguard_connection } from "../networking/wireguard.js"
import { ip_geodata } from "../geolocation/helpers.js"
import { write_pool_score } from "../database/mining_pools.js"
const { CI_MODE, CI_MOCK_MINING_POOL_RESPONSES, CI_MOCK_WORKER_RESPONSES } = process.env

export async function score_mining_pools() {

    // Get mining pool uids and ips
    const mining_pool_uids = get_tpn_cache( 'miner_uids', [] )
    const miner_uid_to_ip = get_tpn_cache( 'miner_uid_to_ip', {} )
    log.info( `Found mining ${ mining_pool_uids.length } pools to score: `, mining_pool_uids )

    // Fisher-Yates shuffle the miner uid array
    shuffle_array( mining_pool_uids )
    log.info( `Shuffled ${ mining_pool_uids.length } mining pools: `, mining_pool_uids )

    // For each mining pool, run test
    const results = {}
    for( const mining_pool_uid of mining_pool_uids ) {

        log.info( `Starting scoring for mining pool ${ mining_pool_uid }` )

        try {

            // Formulate pool label
            const mining_pool_ip = miner_uid_to_ip[ mining_pool_uid ]
            if( !mining_pool_ip ) {
                log.error( `No IP found for mining pool ${ mining_pool_uid }, this should never happen` )
                continue
            }
            const pool_label = `${ mining_pool_uid }@${ mining_pool_ip }`

            // Get mining pool scores
            const { score, stability_score, geo_score, size_score, performance_score } = await score_single_mining_pool( { mining_pool_uid, mining_pool_ip, pool_label } )

            // Save mining pool score to database
            await write_pool_score( { mining_pool_ip, mining_pool_uid, stability_score, geo_score, size_score, performance_score, score } )

            // Write results
            results[ mining_pool_uid ] = { mining_pool_ip, score, stability_score, geo_score, size_score, performance_score }


        } catch ( e ) {
            log.error( `Error scoring mining pool ${ mining_pool_uid }: ${ e.message }` )
        }

    }

    return results


}

async function score_single_mining_pool( { mining_pool_uid, mining_pool_ip, pool_label } ) {

    // Prepare for scoring
    log.info( `Scoring mining pool ${ pool_label }` )

    // Get the latest broadcast metadata of the worker data
    const [ { success: meta_success, last_known_worker_pool_size, updated } ]= await read_worker_broadcast_metadata( { mining_pool_uid, mining_pool_ip, limit: 1 } )
    if( !meta_success ) throw new Error( `No worker broadcast metadata found for mining pool ${ mining_pool_uid }@${ mining_pool_ip }` )

    // Grab the latest workers
    const { success: workers_success, workers } = await get_workers( { mining_pool_uid, mining_pool_ip, limit: last_known_worker_pool_size } )
    if( !workers_success ) throw new Error( `No workers found for mining pool ${ mining_pool_uid }@${ mining_pool_ip }` )

    // Calculate sample size to use
    const sample_size = cochrane_sample_size( { node_count: workers.length } )

    // Select random workers of sample size
    const selected_workers = sample_size >= workers.length ? workers : []
    if( selected_workers.length == 0 ) while( selected_workers.length < sample_size ) {
        const random_worker = workers[ Math.floor( Math.random() * workers.length ) ]
        if( !selected_workers.includes( random_worker ) ) {
            selected_workers.push( random_worker )
        }
    }
    log.info( `Selected ${ selected_workers.length } workers for scoring from mining pool ${ pool_label }` )

    // Score the selected workers
    const scoring_queue = selected_workers.map( worker => async () => {

        try {

            const start = Date.now()

            // Get config of worker through miner
            const { error, json_config, text_config } = await get_worker_config_through_mining_pool( { worker_ip: worker.ip, mining_pool_uid, mining_pool_ip } )
            if( error ) throw new Error( `Error fetching worker config through mining pool: ${ error }` )

            // Check that the worker broadcasts mining pool membership
            const { pool_uid, pool_ip } = CI_MOCK_WORKER_RESPONSES === 'true' ? { pool_uid: mining_pool_uid, pool_ip: mining_pool_ip } : await fetch( `${ json_config.endpoint_ipv4 }` ).then( res => res.json() )
            if( !pool_uid && !pool_ip ) throw new Error( `Worker does not broadcast mining pool membership` )
            if( pool_uid !== mining_pool_uid || pool_ip !== mining_pool_ip ) throw new Error( `Worker is not part of mining pool ${ pool_label }` )

            // Validate that wireguard config works
            const { valid, message } = await test_wireguard_connection( { wireguard_config: text_config } )
            if( !valid ) throw new Error( `Wireguard config invalid: ${ message }` )

            // Check country of ip address
            const [ worker_data ] = await get_workers( { ip: worker.ip, mining_pool_ip, mining_pool_uid } )
            const { country_code, datacenter } = await ip_geodata( worker.ip )
            if( country_code != worker_data.country_code ) throw new Error( `Worker claimed country code ${ worker_data.country_code } does not match geolocated country ${ country_code }` )

            // Calculate test duration
            const test_duration_s = ( Date.now() - start ) / 1_000

            // Return status
            return { success: true, datacenter, test_duration_s }
        
        } catch ( e ) {
            log.info( `Error scoring worker ${ worker.id } in mining pool ${ pool_label }: ${ e.message }` )
            return { success: false, error: e.message }
        }

    } )

    // Wait for all workers to be scored
    const results = await Promise.allSettled( scoring_queue.map( fn => fn() ) )
    const [ successes, failures ] = results.reduce( ( acc, result ) => {

        // If the status was fulfilled and the result is success == true, it counts as a win, otherwise it is a fail;
        const { status, value={}, reason } = result
        const { success, error } = value
        if( success ) acc[0].push( value )
        else acc[1].push( error || reason || 'Unknown error' )

        return acc
    }, [ [], [] ] )

    // Get the context needed to calculate scores
    const countries_in_pool = await get_worker_countries_for_pool( { mining_pool_uid, mining_pool_ip } )

    // Calculate stability score (up fraction)
    const stability_fraction = successes.length / results.length
    const stability_score = stability_fraction * 100

    // Calculate size score, defined as the ranking of the size against the last_known_worker_pool_size 
    const size_score = last_known_worker_pool_size * stability_fraction

    // Calculate performance score
    const mean_test_length_s = successes.reduce( ( acc, { test_duration_s } ) => acc + test_duration_s, 0 ) / successes.length
    const performance_score = Math.min( 100 / mean_test_length_s, 100 )
    const performance_fraction = performance_score / 100

    // Calculate the geographic score
    const total_countries = 249
    const geo_completeness_fraction = countries_in_pool.length / total_countries
    const geo_score = geo_completeness_fraction * 100

    // Calculate the composit score
    const score = size_score * performance_fraction * geo_completeness_fraction

    // Return the scores
    return {
        stability_score: Math.floor( stability_score ),
        size_score: Math.floor( size_score ),
        performance_score: Math.floor( performance_score ),
        geo_score: Math.floor( geo_score ),
        score: Math.floor( score )
    }

}

