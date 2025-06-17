import { Router } from "express"
import { cache, log, make_retryable } from "mentie"
import { request_is_local } from "../modules/network.js"
export const router = Router()


/**
 * Route to handle validator ips submitted from the neuron
 */
router.post( "/broadcast/validators", async ( req, res ) => {

    // Make sure this request came from localhost
    if( !request_is_local( req ) ) return res.status( 403 ).json( { error: `Request not from localhost` } )

    const handle_route = async () => {

        // Get ip addresses from the request
        const { validators=[] } = req.body || {}

        // Validate that all validator have the { uid, ip } format where ip is regex matched as ipv4 naively
        if( !Array.isArray( validators ) || validators.length == 0 ) {
            log.warn( `No validator ips provided: `, req.body )
            throw new Error( `No validator ips provided` )
        }
        const valid_entries = validators.filter( entry => {
            const { uid, ip } = entry
            if( !uid || !ip ) return false
            const is_ipv4 = ip.match( /\d*.\d*.\d*.\d*/ )
            if( !is_ipv4 ) return false
            return true
        } )
        log.info( `Valid validator entries: ${ valid_entries.length }` )

        // If there are no valid entries, throw an error
        if( valid_entries.length == 0 ) throw new Error( `No valid validator ips provided` )

        // Cache ip country data to memory
        log.info( `Caching validator ip data: `, valid_entries )
        cache( 'last_known_validators', valid_entries )

        return res.json( {
            valid_entries,
            success: true
        } )

    }

    try {

        const retryable_handler = await make_retryable( handle_route, { retry_times: 1, cooldown_in_s: 10, cooldown_entropy: false } )
        return retryable_handler()
        
    } catch ( e ) {

        log.warn( `Error handling miner ip submitted from neuron. Error:`, e )
        return res.status( 200 ).json( { error: e.message } )

    }
} )