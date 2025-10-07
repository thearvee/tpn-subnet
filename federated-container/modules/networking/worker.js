import { abort_controller, log, sanetise_string } from "mentie"

export const get_worker_mining_pool_url = () => {

    // Get url setting
    let { MINING_POOL_URL: _MINING_POOL_URL } = process.env

    // Check if set at all
    if( !`${ _MINING_POOL_URL }`.length ) return undefined 

    // Sanetise
    _MINING_POOL_URL = sanetise_string( _MINING_POOL_URL )
    
    // Remove trailing slashes
    _MINING_POOL_URL = _MINING_POOL_URL.replace( /\/+$/, '' )

    return _MINING_POOL_URL

}

export const MINING_POOL_URL = get_worker_mining_pool_url()

/**
 * 
 * @param {Object} params 
 * @param {Object} params.worker - The worker object
 * @param {number} [params.max_retries=1] - The maximum number of retry attempts
 * @param {number} [params.lease_seconds=120] - The lease duration in seconds
 * @param {string} [params.format='json'] - The response format
 * @param {number} [params.timeout_ms=5_000] - The request timeout in milliseconds
 * @returns {Promise<Object|String>} - The WireGuard configuration
 */
export async function get_wireguard_config_directly_from_worker( { worker, max_retries=1, lease_seconds=120, format='text', timeout_ms=5_000 } ) {

    const { ip, public_port=3000 } = worker
    const { CI_MOCK_WORKER_RESPONSES } = process.env
    const query = `http://${ ip }:${ public_port }/api/lease/new?lease_seconds=${ lease_seconds }&format=${ format }`


    // Get config from workers
    let config = null
    let attempts = 0
    while( !config && attempts < max_retries ) {
    
        // Fetch config
        attempts++
        const { fetch_options } = abort_controller( { timeout_ms } )
        log.info( `Attempt ${ attempts }/${ max_retries } to get ${ query }` )
        config = await fetch( query, fetch_options ).then( res => format === 'json' ? res.json() : res.text() )
        log.info( `Received config from worker ${ ip }` )
    
    }

    // On mock success
    if( CI_MOCK_WORKER_RESPONSES ) config = config || format === 'json' ? { endpoint_ipv4: 'mock.mock.mock.mock' } : "Mock WireGuard config"
    
    return config
}