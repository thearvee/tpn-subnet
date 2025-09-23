import { abort_controller, is_ipv4, log, shuffle_array } from "mentie"
import { get_wireguard_config_directly_from_worker } from "../networking/worker.js"
import { get_validators } from "../networking/validators.js"
import { get_workers } from "../database/workers.js"
import { base_url } from "../networking/url.js"
const { CI_MODE, CI_MOCK_MINING_POOL_RESPONSES } = process.env

export async function get_worker_config_as_miner( { geo, format='text', whitelist, blacklist, lease_seconds } ) {

    // Get relevant workers
    let { workers: relevant_workers } = await get_workers( { country_code: geo, mining_pool_uid: 'internal', status: 'up', limit: 50 } )
    log.info( `Found ${ relevant_workers.length } relevant workers for geo ${ geo }` )
    if( blacklist?.length ) relevant_workers = relevant_workers.filter( ( { ip } ) => !blacklist.includes( ip ) )
    if( whitelist?.length ) relevant_workers = relevant_workers.filter( ( { ip } ) => whitelist.includes( ip ) )
    log.info( `Filtered to ${ relevant_workers.length } relevant workers for geo ${ geo }` )

    // If no workers, exit
    if( CI_MOCK_MINING_POOL_RESPONSES !== 'true' && !relevant_workers?.length ) {
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
        config = await get_wireguard_config_directly_from_worker( { worker, format, lease_seconds } )

    }

    // On mock success
    if( CI_MOCK_MINING_POOL_RESPONSES === 'true' ) config = config || format === 'json' ? { endpoint_ipv4: 'mock.mock.mock.mock' } : "Mock WireGuard config"
    
    // Return the config
    return config

}

export async function register_mining_pool_with_validators() {

    // Get validator ip list
    const validator_ips = await get_validators( { ip_only: true } )

    // Formulate identity
    let { SERVER_PUBLIC_PORT: port=3000, SERVER_PUBLIC_PROTOCOL: protocol='http', SERVER_PUBLIC_HOST } = process.env
    const identity = { protocol, url: base_url, port }
    log.info( `Registering mining pool with validators:`, identity )

    // Register with validators with allSettled
    const results = await Promise.allSettled( validator_ips.map( async ip => {
        
        // Abort controller
        let { signal } = abort_controller( { timeout_ms: 60_000 } )

        // Get protocol data from validator
        const validator_broadcast = await fetch( `http://${ ip }:3000/`, { signal } ).then( res => res.json() )

        // Formulate registration request
        ;( { signal } = abort_controller( { timeout_ms: 30_000 } ) )
        const body = JSON.stringify( identity )
        const protocol = validator_broadcast.SERVER_PUBLIC_PROTOCOL || 'http'
        const host = validator_broadcast.SERVER_PUBLIC_HOST || ip
        const port = validator_broadcast.SERVER_PUBLIC_PORT || 3000
        const url = `${ protocol }://${ host }:${ port }/validator/broadcast/mining_pool`
        return fetch( url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body,
            signal
        } ).then( res => res.json() )

    } ) )

    const [ successes, failures ] = results.reduce( ( acc, result ) => {
        if( result.status === 'fulfilled' ) acc[ 0 ].push( result.value )
        else acc[ 1 ].push( result.reason )
        return acc
    }, [ [], [] ] )
    log.info( `Registered mining pool with validators: ${ successes.length }, failed: ${ failures.length }` )

    return { successes, failures }

}

export async function register_mining_pool_workers_with_validators() {

    // Get validator ip list
    const validator_ips = await get_validators( { ip_only: true } )

    // Get all worker data and structure it
    const { workers } = await get_workers( { mining_pool_uid: 'internal' } )
    log.info( `Broadcasting ${ workers.length } workers to ${ validator_ips.length } validators` )

    // Register with validators with allSettled
    const results = await Promise.allSettled( validator_ips.map( async ip => {

        // Abort controller
        let { signal } = abort_controller( { timeout_ms: 60_000 } )

        // Get protocol data from validator
        const validator_broadcast = await fetch( `http://${ ip }:3000/`, { signal } ).then( res => res.json() )

        // Formulate registration request
        ;( { signal } = abort_controller( { timeout_ms: 30_000 } ) )
        const body = JSON.stringify( { workers } )
        const protocol = validator_broadcast.SERVER_PUBLIC_PROTOCOL || 'http'
        const host = validator_broadcast.SERVER_PUBLIC_HOST || ip
        const port = validator_broadcast.SERVER_PUBLIC_PORT || 3000
        const url = `${ protocol }://${ host }:${ port }/validator/broadcast/workers`
        log.info( `Registering at ${ url } with ${ workers.length } workers.`, CI_MODE === 'true' ? body : '' )
        return fetch( url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body,
            signal
        } ).then( res => res.json() )

    } ) )

    const [ successes, failures ] = results.reduce( ( acc, result ) => {
        if( result.status === 'fulfilled' ) acc[ 0 ].push( result.value )
        else acc[ 1 ].push( result.reason )
        return acc
    }, [ [], [] ] )
    log.info( `Registered workers with validators: ${ successes.length }, failed: ${ failures.length }`, successes, failures )

    return { successes, failures }

}