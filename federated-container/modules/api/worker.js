import { log } from "mentie"
import { get_valid_wireguard_config } from "../networking/wg-container.js"
import { parse_wireguard_config } from "../networking/wireguard.js"

export async function get_worker_config_as_worker( { lease_seconds, priority, format } ) {

    const { wireguard_config, peer_id, peer_slots, expires_at } = await get_valid_wireguard_config( { lease_seconds, priority } )
    if( !wireguard_config ) throw new Error( `Failed to get valid wireguard config for ${ lease_seconds }, ${ priority ? 'with' : 'without' } priority` )
    log.info( `Obtained WireGuard config for peer_id ${ peer_id } with ${ peer_slots } slots, expires at ${ new Date( expires_at ).toISOString() }` )

    // Return right format
    const { json_config, text_config } = parse_wireguard_config( { wireguard_config } )
    if( format == 'text' ) return text_config
    return json_config

}

export async function register_with_mining_pool() {

    // Get required registration info
    const { MINING_POOL_URL } = process.env
    const wg_config = await get_valid_wireguard_config( { lease_seconds: 120_000, priority: true } )
    const query = `${ MINING_POOL_URL }/miner/broadcast/worker`
    const post_data = { wg_config }
    log.info( `Registering with mining pool ${ MINING_POOL_URL } at ${ query }` )

    // Post to the miner
    const { registered, worker } = await fetch( query, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify( post_data )
    } ).then( res => res.json() )
    log.info( `Registered with mining pool ${ MINING_POOL_URL } as: `, worker )

    return { registered, worker }

}