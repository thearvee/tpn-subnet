import { Router } from 'express'
import { log } from 'mentie'
import { annotate_worker_with_defaults, is_valid_worker } from '../../modules/validations.js'
import { map_ips_to_geodata } from '../../modules/geolocation/ip_mapping.js'
import { ip_geodata } from '../../modules/geolocation/helpers.js'
import { write_workers } from '../../modules/database/workers.js'
import { validate_and_annotate_workers } from '../../modules/scoring/score_workers.js'

export const router = Router()

/**
 * Handle the submission of worker lists from mining pools
 * @params {Object} req.body.workers - Array of worker objects with properties: ip, country_code
 */
router.post( '/worker', async ( req, res ) => {

    try {
        
        // Get workerdata from request from the request
        const { wireguard_config } = req.body || {}
        const { unspoofable_ip } = req.query
        
        // Validate inputs
        if( !wireguard_config ) throw new Error( `Missing WireGuard configuration in request` )

        // Get worker data
        const { country_code, datacenter } = await ip_geodata( unspoofable_ip )
        let worker = { ip: unspoofable_ip, country_code, datacenter, status: 'up' }
        worker = annotate_worker_with_defaults( worker )
        worker.wireguard_config = wireguard_config
        if( !is_valid_worker( worker ) ) throw new Error( `Invalid worker data received` )

        // Check that worker is valid
        const { successes, failures } = await validate_and_annotate_workers( { workers_with_configs: [ worker ] } )
        if( !successes.length ) {
            log.info( `Worker failed validation`, failures )
            throw new Error( `Worker failed validation` )
        }

        // Cache geodata for this worker
        await map_ips_to_geodata( { ips: [ worker.ip ], cache_prefix: `worker_`, prefix_merge: true } )

        // Save worker to database
        await write_workers( { workers: [ worker ], mining_pool_uid: 'internal', mining_pool_ip: 'internal' } )

        // Resolve to success
        return res.json( { registered: true, worker } )


    } catch ( e ) {
        
        log.warn( `Error handling neuron broadcast. Error:`, e )
        return res.status( 200 ).json( { error: e.message } )

    }
} )
