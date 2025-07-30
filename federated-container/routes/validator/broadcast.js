import { Router } from 'express'
import { log, make_retryable, sanetise_ipv4 } from 'mentie'
import { cooldown_in_s, retry_times } from "../../modules/networking/routing.js"
import { is_validator_request } from '../../modules/networking/validators.js'
import { is_valid_worker } from '../../modules/validations.js'
import { write_workers } from '../../modules/database/workers.js'

export const router = Router()

/**
 * Handle the submission of worker lists from mining pools
 * @params {Object} req.body.workers - Array of worker objects with properties: ip, country_code
 */
router.post( '/workers', async ( req, res ) => {

    // This endpoint is only for validators
    const { uid: mining_pool_uid, ip: mining_pool_ip } = await is_validator_request( req )
    if( !mining_pool_uid ) return res.status( 403 ).json( { error: `Requester ${ mining_pool_ip } not a known validator` } )

    const handle_route = async () => {

        // Get workers from the request
        let { workers=[] } = req.body || {}
        log.info( `Received ${ workers.length } workers from validator ${ mining_pool_uid }@${ mining_pool_ip }` )

        // Clean up the worker data
        workers = workers.reduce( ( acc, worker ) => {

            // Skip invalid
            if( !is_valid_worker( worker ) ) return acc

            
            // Sanetise the IP address
            let { ip, country_code } = worker || {}
            ip = sanetise_ipv4( { ip, validate: true } )
            acc.push( { ip, country_code } )

            return acc

        }, [] )
        log.info( `Sanetised worker data, ${ workers.length } valid entries` )

        // Save workers to database
        const write_result = await write_workers( { workers, mining_pool_uid, mining_pool_ip } )
        return { ...write_result, mining_pool_uid, mining_pool_ip }

    }

    try {

        const retryable_handler = await make_retryable( handle_route, { retry_times, cooldown_in_s } )
        const response_data = await retryable_handler()
        return res.json( response_data )

    } catch ( e ) {
        
        log.warn( `Error handling neuron broadcast. Error:`, e )
        return res.status( 200 ).json( { error: e.message } )

    }
} )