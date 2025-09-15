import { cache, log, shuffle_array } from "mentie"
import { get_tpn_cache } from "../caching.js"
import { get_worker_countries_for_pool, get_workers, read_worker_broadcast_metadata, write_workers } from "../database/workers.js"
import { cochrane_sample_size } from "../math/samples.js"
import { get_worker_config_through_mining_pool, validate_and_annotate_workers } from "./score_workers.js"
import { write_pool_score } from "../database/mining_pools.js"
import { get_miners } from "../networking/miners.js"
const { CI_MODE, CI_MOCK_MINING_POOL_RESPONSES, CI_MOCK_WORKER_RESPONSES, CI_MINER_IP_OVERRIDES } = process.env

/**
 * Validator function to score mining pools based on worker performance
 * @returns {Object} results - Object containing the scores of each mining pool
 */
export async function score_mining_pools( max_duration_minutes=30 ) {

    try {


        // Set up a lock to prevent race conditions
        const lock = cache( `score_mining_pools_running` )
        if( lock ) return log.warn( `score_mining_pools is already running` )
        cache( `score_mining_pools_running`, true, max_duration_minutes * 60_000 )

        // Get mining pool uids and ips
        const mining_pool_uids = get_tpn_cache( 'miner_uids', [] )
        const miner_uid_to_ip = get_tpn_cache( 'miner_uid_to_ip', {} )
        log.info( `Found mining ${ mining_pool_uids.length } pools to score: `, mining_pool_uids )

        // If we are running in CI mode, add a the live testing mining pool if defined
        if( CI_MODE === 'true' ) {

            const override_ips = await get_miners( { overrides_only: true } )
            override_ips.forEach( ( { ip, uid } ) => {
                mining_pool_uids.push( uid )
                miner_uid_to_ip[ uid ] = ip
                log.info( `Added CI override mining pool ${ uid }@${ ip }` )
            } )

        }

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
                log.error( `Error scoring mining pool ${ mining_pool_uid }:`, e )
            }

        }

        // Return results
        return results


    } catch ( e ) {
        log.error( `Error scoring mining pools:`, e )
    } finally {

        // Unlock
        cache( `score_mining_pools_running`, false )

    }

}

async function score_single_mining_pool( { mining_pool_uid, mining_pool_ip, pool_label } ) {

    // Prepare for scoring
    log.info( `Scoring mining pool ${ pool_label }` )

    // Get the latest broadcast metadata of the worker data
    const [ { success: meta_success, last_known_worker_pool_size, updated }={} ]= await read_worker_broadcast_metadata( { mining_pool_uid, mining_pool_ip, limit: 1 } )
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

    // Annotate the selected workers with a wireguard config for testing in paralell
    await Promise.allSettled( selected_workers.map( async ( worker, index ) => {
        const { error, json_config, text_config } = await get_worker_config_through_mining_pool( { worker_ip: worker.ip, mining_pool_uid, mining_pool_ip } )
        if( text_config ) selected_workers[ index ].wireguard_config = text_config
        if( error ) log.info( `Error fetching worker config for ${ worker.ip }: ${ error }` )
    } ) )

    // Score the selected workers
    const { successes, failures, workers_with_status } = await validate_and_annotate_workers( { workers_with_configs: selected_workers } )

    // Save updated worker data to database
    await write_workers( { workers: workers_with_status, mining_pool_uid, mining_pool_ip } )

    // Get the context needed to calculate scores
    const countries_in_pool = await get_worker_countries_for_pool( { mining_pool_uid, mining_pool_ip } )

    // Calculate stability score (up fraction)
    const stability_fraction = successes.length / selected_workers.length
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

