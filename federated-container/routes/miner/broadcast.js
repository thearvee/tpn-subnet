import { Router } from 'express'
import { log } from 'mentie'
import { is_valid_worker } from '../../modules/validations.js'
import { map_ips_to_geodata } from '../../modules/geolocation/ip_mapping.js'
import { ip_geodata } from '../../modules/geolocation/helpers.js'
import { test_wireguard_connection } from '../../modules/networking/wireguard.js'
import { write_workers } from '../../modules/database/workers.js'

export const router = Router()

/**
 * Handle the submission of worker lists from mining pools
 * @params {Object} req.body.workers - Array of worker objects with properties: ip, country_code
 */
router.post( '/worker', async ( req, res ) => {

    try {
        
        // Get workerdata from request from the request
        const { wg_config } = req.body || {}
        const { unspoofable_ip } = req.query
        
        // Validate inputs
        if( !wg_config ) throw new Error( `Missing WireGuard configuration in request` )

        // Get worker data
        const { country_code, datacenter } = await ip_geodata( unspoofable_ip )
        const worker = { ip: unspoofable_ip, country_code, datacenter, status: 'up' }
        if( !is_valid_worker( worker ) ) throw new Error( `Invalid worker data received` )

        // Check if supplied config is valid
        const { valid } = await test_wireguard_connection( { wg_config } )
        if( !valid ) throw new Error( `Invalid WireGuard configuration` )

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
