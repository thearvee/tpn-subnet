import { log } from "mentie"
import { get_valid_wireguard_config } from "../networking/wg-container.js"
import { parse_wireguard_config } from "../networking/wireguard.js"
import { MINING_POOL_URL } from "../networking/worker.js"
import { mark_config_as_free } from "../database/worker_wireguard.js"
import { base_url } from "../networking/url.js"

/**
 * Get the worker configuration as a worker.
 * @param {Object<{ lease_seconds: number, priority: boolean, format: string }>} params
 * @returns {Promise<Object>}
 */
export async function get_worker_config_as_worker( { lease_seconds, priority, format } ) {

    const { wireguard_config, peer_id, peer_slots, expires_at } = await get_valid_wireguard_config( { lease_seconds, priority } )
    if( !wireguard_config ) throw new Error( `Failed to get valid wireguard config for ${ lease_seconds }, ${ priority ? 'with' : 'without' } priority` )
    log.info( `Obtained WireGuard config for peer_id ${ peer_id } with ${ peer_slots } slots, expires at ${ new Date( expires_at ).toISOString() }` )

    // Return right format
    const { json_config, text_config } = parse_wireguard_config( { wireguard_config } )
    if( format == 'text' ) return text_config
    return json_config

}

/**
 * Registers the worker with the mining pool.
 * @returns {Promise<{ registered: boolean, worker: object }>}
 */
export async function register_with_mining_pool() {

    try { 

        // Get worker configs
        const public_url = base_url()
        const { PAYMENT_ADDRESS_EVM, PAYMENT_ADDRESS_BITTENSOR } = process.env

        // Get required registration info
        const { wireguard_config, peer_id } = await get_valid_wireguard_config( { lease_seconds: 120, priority: true } )
        const query = `${ MINING_POOL_URL }/miner/broadcast/worker`
        const post_data = { wireguard_config, mining_pool_url: MINING_POOL_URL, public_url, payment_address_evm: PAYMENT_ADDRESS_EVM, payment_address_bittensor: PAYMENT_ADDRESS_BITTENSOR }
        log.info( `Registering with mining pool ${ MINING_POOL_URL } at ${ query }` )

        // Post to the miner
        const { registered, worker, error } = await fetch( query, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify( post_data )
        } ).then( res => res.json() )
        if( !error ) log.info( `Registered with mining pool ${ MINING_POOL_URL } as: `, worker )
        if( error ) {
            log.warn( `Error registering with mining pool ${ MINING_POOL_URL }: ${ error }` )
            // Mark the config as free again, if the mining pool did not accept it then there is no conflict risk
            await mark_config_as_free( { peer_id } )
        }

        return { registered, worker }
        
    } catch ( e ) {
        log.error( `Error registering with mining pool ${ MINING_POOL_URL }: `, e )
        return { registered: false, error: e.message }
    }

}