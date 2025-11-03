import { Router } from "express"
import { get_complete_tpn_cache, get_tpn_cache } from "../../modules/caching.js"
import { get_pool_scores, read_mining_pool_metadata } from "../../modules/database/mining_pools.js"
import { abort_controller, cache, log } from "mentie"
import { get_worker_countries_for_pool, read_worker_broadcast_metadata } from "../../modules/database/workers.js"

export const router = Router()

/**
 * Route to handle stats submitted from the neuron
 */
router.get( "/stats", ( req, res ) => {

    // Get tpn cache
    const tpn_cache = get_complete_tpn_cache()

    return res.json( tpn_cache )

} )

router.get( "/stats/pools", async ( req, res ) => {

    try {

        // Check for caches value
        const cached_pool_data = cache( 'protocol_stats_pools' )
        if( cached_pool_data ) {
            log.info( `Returning cached protocol stats pools data` )
            return res.json( cached_pool_data )
        }

        // Get pool metadata
        const miner_uid_to_ip = get_tpn_cache( 'miner_uid_to_ip', {} )
        let { pools: pools_metadata  } = await read_mining_pool_metadata( { limit: null } )
        log.info( `Fetched metadata for ${ pools_metadata?.length || 0 } mining pools from database` )
        pools_metadata = pools_metadata.filter( ( { mining_pool_ip, mining_pool_uid }  ) => {
            const expected_ip = miner_uid_to_ip?.[ mining_pool_uid ]
            if( expected_ip === undefined ) {
                log.debug( `Excluding mining pool ${ mining_pool_uid } with IP ${ mining_pool_ip }: not found in miner_uid_to_ip cache` )
                return false
            }
            return mining_pool_ip === expected_ip
        }  )
        log.info( `Filtered metadata to ${ pools_metadata?.length || 0 } mining pools` )
        log.debug( `Pools metadata example: `, pools_metadata[0] )

        // Sort pools_metadata by mining_pool_uid ascending
        pools_metadata = pools_metadata.map( ( { mining_pool_uid, ...pool } ) => ( { mining_pool_uid: Number( mining_pool_uid ), ...pool } ) )
        pools_metadata.sort( ( a, b ) => a.mining_pool_uid - b.mining_pool_uid )

        // Get mining pool scores
        const { scores: mining_pool_scores } = await get_pool_scores()
        log.info( `Fetched scores for ${ mining_pool_scores?.length || 0 } mining pools from database` )
        log.debug( `Mining pool scores example: `, mining_pool_scores[0] )

        // Collate data by mining pool uid
        const pools = await Promise.all( pools_metadata?.map( async pool => {

            // Get validator level data
            const { mining_pool_uid, url } = pool || {}
            const { score, stability_score, size_score, performance_score, geo_score } = mining_pool_scores.find( p => p.mining_pool_uid === mining_pool_uid ) || {}

            // Get worker countries for this pool
            const countries = await get_worker_countries_for_pool( { mining_pool_uid } )

            // Get pool metadata
            const [ { last_known_worker_pool_size }={} ] = await read_worker_broadcast_metadata( { mining_pool_uid } )

            // Get pool broadcast data
            const { fetch_options } = abort_controller( { timeout_ms: 1_000 } )
            const { version, MINING_POOL_REWARDS, MINING_POOL_WEBSITE_URL } = await fetch( url, fetch_options ).then( res => res.json() ).catch( e => ( { error: e.message } ) )

            const data = {
                mining_pool_uid,
                url,
                score,
                stability_score,
                size_score,
                performance_score,
                geo_score,
                version,
                MINING_POOL_REWARDS,
                MINING_POOL_WEBSITE_URL,
                countries,
                last_known_worker_pool_size
            }

            // Return data for this pool
            return data

        }  ) )

        // Cache the full pools array
        const cache_minutes = 10
        cache( 'protocol_stats_pools', pools, cache_minutes * 60_000 )

        // Return pools data
        return res.json( pools )


    } catch ( e ) {
        return res.status( 500 ).json( { error: e.message } )
    }

} )