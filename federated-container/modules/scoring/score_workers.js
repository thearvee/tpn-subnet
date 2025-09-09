import { abort_controller, cache, log, make_retryable } from "mentie"
import { read_mining_pool_metadata } from "../database/mining_pools.js"
import { parse_wireguard_config, test_wireguard_connection } from "../networking/wireguard.js"
import { is_valid_worker } from "../validations.js"
import { ip_geodata } from "../geolocation/helpers.js"
import { get_workers, write_workers } from "../database/workers.js"
import { get_wireguard_config_directly_from_worker } from "../networking/worker.js"
const { CI_MOCK_WORKER_RESPONSES } = process.env

/**
 * Miner function to test all knwn workers
 */
export async function score_all_known_workers( max_duration_minutes=15 ) {

    try { 

        // Set a lock on this activity to prevent races
        const locked = cache( `score_all_known_workers_running` )
        if( locked ) return log.warn( `score_all_known_workers is already running` )
        cache( `score_all_known_workers_running`, true, max_duration_minutes * 60_000 )

        // Get all known workers
        const { workers } = await get_workers( { mining_pool_uid: 'internal' } )
        if( !workers?.length ) throw new Error( `No known workers to score` )

        // Get a config directly from each worker
        await Promise.allSettled( workers.map( async ( worker, index ) => {
            const wireguard_config = await get_wireguard_config_directly_from_worker( { worker } )
            const { text_config, json_config } = parse_wireguard_config( { wireguard_config } )
            if( text_config ) workers[ index ].wireguard_config = text_config
        } ) )

        // Test all known workers
        const { successes, failures } = await validate_and_annotate_workers( { workers_with_configs: workers } )

        // Save all worker data
        const annotated_workers = [
            ...successes.map( worker => ( { ...worker, status: 'up' } ) ),
            ...failures.map( worker => ( { ...worker, status: 'down' } ) )
        ]

        // Save annotated workers to database
        await write_workers( { annotated_workers, mining_pool_uid: 'internal' } )

        // Unlock
        cache( `score_all_known_workers_running`, false )
    } catch ( e ) {
        log.error( `Error scoring all known workers: ${ e.message }` )
    }

}

/**
 * Validator function to get worker config through mining pool
 * @param {Object} params
 * @param {string} params.worker_ip - IP address of the worker
 * @param {string} params.mining_pool_uid - UID of the mining pool
 * @param {string} params.mining_pool_ip - IP address of the mining pool
 * @returns {Promise<Object>} - Promise resolving to the worker config
 */
export async function get_worker_config_through_mining_pool( { worker_ip, mining_pool_uid, mining_pool_ip } ) {

    try {

        // Get mining pool data
        const { protocol, url, port } = await read_mining_pool_metadata( { mining_pool_ip, mining_pool_uid } )
        const endpoint = `${ protocol }://${ url }:${ port }/pool/config/new`
        const query = `?lease_seconds=120&format=json&whitelist=${ worker_ip }`

        // Mock response if needed
        const { CI_MOCK_MINING_POOL_RESPONSES } = process.env
        if( CI_MOCK_MINING_POOL_RESPONSES === 'true' ) {
            log.info( `CI_MOCK_MINING_POOL_RESPONSES is enabled, returning mock response for ${ endpoint }/${ query }` )
            return { json_config: { endpoint_ipv4: 'mock.mock.mock.mock' }, text_config: "" }
        }

        // Make retryable and cancellable request to mining pool for worker ip
        const timeout_ms = 10_000
        const { fetch_options } = abort_controller( { timeout_ms } )
        const fetch_function = async () => fetch( `${ endpoint }${ query }`, fetch_options ).then( res => res.json() )
        const retryable_fetch = await make_retryable( fetch_function, { retry_times: 2, cooldown_in_s: 2 } )
        const worker_config = await retryable_fetch()

        // Validate that the wireguard config is correct
        const { config_valid, json_config, text_config } = parse_wireguard_config( { wireguard_config: worker_config, expected_endpoint_ip: worker_ip } )
        if( !config_valid ) throw new Error( `Invalid wireguard config for ${ worker_ip }` )

        return { json_config, text_config }

    } catch ( e ) {
        log.info( `Error getting worker config for ${ worker_ip } through mining pool ${ mining_pool_ip }: ${ e.message }` )
        return { error: e.message }
    }

}

/**
 * Checks whether the worker objects are valid and work
 * @param {Object} params
 * @param {Array} params.workers_with_configs
 * @param {string} params.workers_with_configs[].ip - IP address of the worker
 * @param {string} params.workers_with_configs[].wireguard_config - Wireguard configuration of the worker
 * @param {string} params.workers_with_configs[].country_code - Country code of the worker
 * @param {string} params.workers_with_configs[].public_port - Public port of the worker
 * @param {string} params.workers_with_configs[].mining_pool_url - URL of the mining pool
 * @returns {Promise<Object>} Object with successes and failures arrays
 * @returns {Array} returns.successes - Array of successful worker tests
 * @returns {Array} returns.failures - Array of failed worker tests
 */
export async function validate_and_annotate_workers( { workers_with_configs=[] } ) {

    // If worker config list exceeds 250, warn this is close to ip subnet limit and might cause issues
    if( workers_with_configs.length > 250 ) {
        log.warn( `Worker config list exceeds 250, this may cause issues with IP subnet limits` )
    }

    // Check that all workers are valid and have configs attached
    const [ valid_workers, invalid_workers ] = workers_with_configs.reduce( ( acc, worker ) => {

        const valid_worker = is_valid_worker( worker )
        const { wireguard_config } = worker
        const { config_valid, json_config, text_config } = parse_wireguard_config( { wireguard_config } )
        const is_valid = valid_worker && config_valid

        if( !is_valid ) acc[1].push( { ...worker, json_config, text_config, reason: `${ valid_worker ? 'valid' : 'invalid' } worker, ${ config_valid ? 'valid' : 'invalid' } wg config` } )
        else acc[0].push( worker )

        return acc

    }, [ [], [] ] )

    // Score the selected workers
    const scoring_queue = valid_workers.map( worker => async () => {

        // Prepare test
        const start = Date.now()
        const test_result = { ...worker }

        try {
    
            // Start test
            const { json_config, text_config, mining_pool_url } = worker

            // Check that the worker broadcasts mining pool membership
            const mock_pool_check = CI_MOCK_WORKER_RESPONSES === 'true' 
            const { MINING_POOL_URL } = mock_pool_check ? { MINING_POOL_URL: 'http://mock.mock.mock.mock' } : await fetch( `${ json_config.endpoint_ipv4 }` ).then( res => res.json() )
            if( !mock_pool_check && !MINING_POOL_URL ) throw new Error( `Worker does not broadcast mining pool membership` )
            if( MINING_POOL_URL !== mining_pool_url ) throw new Error( `Worker broadcast ${ mining_pool_url } != ${ MINING_POOL_URL }` )
    
            // Validate that wireguard config works
            const { valid, message } = await test_wireguard_connection( { wireguard_config: text_config } )
            if( !valid ) throw new Error( `Wireguard config invalid: ${ message }` )

            // Get the most recent country data for these workers
            const { country_code, datacenter } = await ip_geodata( worker.ip )
            test_result.country_code = country_code
            test_result.datacenter = datacenter

            // Set test result
            test_result.success = true

        } catch ( e ) {
            log.info( `Error scoring worker ${ worker.ip }: ${ e.message }` )
            test_result.success = false
            test_result.error = e.message
        } finally {
            test_result.test_duration_s = ( Date.now() - start ) / 1_000
        }

        return test_result
    
    } )
    
    // Wait for all workers to be scored
    const results = await Promise.allSettled( scoring_queue.map( fn => fn() ) )
    const [ successes, failures ] = results.reduce( ( acc, worker ) => {
    
        // If the status was fulfilled and the result is success == true, it counts as a win, otherwise it is a fail;
        const { status, value={} } = worker
        const { success, error } = value
        if( error ) value.reason += ` - promise resolved ${ status }, error ${ error }`
        if( success ) acc[0].push( value )
        else acc[1].push( value )
    
        return acc
    }, [ [], [ ...invalid_workers ] ] )
    log.info( `Completed with ${ successes.length } successes and ${ failures.length } failures` )

    // Collate results
    const workers_with_status = [
        ...successes.map( worker => ( { ...worker, status: 'up' } ) ),
        ...failures.map( worker => ( { ...worker, status: 'down' } ) )
    ]

    return { successes, failures, workers_with_status }

}