import { abort_controller, log, make_retryable } from "mentie"
import { read_mining_pool_metadata } from "../database/mining_pools.js"
import { parse_wireguard_config } from "../networking/wireguard.js"

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

