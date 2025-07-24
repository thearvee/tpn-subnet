import { Router } from 'express'
import { is_ipv4, log, make_retryable, sanetise_ipv4 } from 'mentie'
import { cooldown_in_s, retry_times } from "../../modules/networking/routing.js"
import { is_validator_request } from '../../modules/networking/validators.js'
import { get_tpn_cache } from '../../modules/caching.js'


const router = Router()

/**
 * Handle the submission of worker lists from mining pools
 * @params {Object} req.body.workers - Array of worker objects with properties: ip, country_code
 */
router.post( '/workers', async ( req, res ) => {

    // This endpoint is only for validators
    const { uid, ip } = is_validator_request( req )
    if( !uid ) return res.status( 403 ).json( { error: `Requester ${ ip } not a known validator` } )

    const handle_route = async () => {

        // Get workers from the request
        let { workers=[] } = req.body || {}
        log.info( `Received ${ workers.length } workers from validator ${ uid }@${ ip }` )

        // Clean up the worker data
        const miner_country_code_to_name = get_tpn_cache( 'miner_country_code_to_name', {} )
        workers = workers.reduce( ( acc, worker ) => {

            let { ip, country } = worker || {}
            
            // Skip workers with invalid data
            const valid_ip = is_ipv4( ip )
            const valid_country = miner_country_code_to_name[ country ] !== undefined
            if( !valid_ip ) log.info( `Worker ip ${ ip } is invalid` )
            if( !valid_country ) log.info( `Worker country ${ country } is invalid` )
            if( !valid_ip || !valid_country ) return acc

            // Sanetise the IP address
            ip = sanetise_ipv4( { ip, validate: true } )
            acc.push( { ip, country } )

            return acc

        }, [] )
        log.info( `Sanetised worker data, ${ workers.length } valid entries` )

        // Save workers to database
        ...

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