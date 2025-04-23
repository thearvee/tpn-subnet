import { Router } from "express"
import { log, make_retryable } from "mentie"
import { is_validator } from "../modules/validators"
import { save_ip_address_and_return_ip_stats } from "../modules/database"
export const router = Router()


router.post( "/broadcast/miner_ip", async ( req, res ) => {

    // Make sure this request came from another validator
    const request_from_validator = is_validator( req )
    if( !request_from_validator ) {
        log.info( `Request not from validator, returning 403` )
        return res.status( 403 ).json( { error: `Request not from validator` } )
    }

    const handle_route = async () => {

        // Get ip addresses from the request
        const { ip_addresses=[] } = req.body || {}

        // Validate ip address inputs
        if( !ip_addresses || !Array.isArray( ip_addresses ) || ip_addresses.length == 0 ) {
            return res.status( 400 ).json( { error: `Invalid input, expected an array of ip addresses` } )
        }

        // Check that the ip addresses are ipv4 vaively
        const is_ipv4 = ip_addresses.every( ip => ip.match( /\d*.\d*.\d*.\d*/ ) )
        if( !is_ipv4 ) {
            return res.status( 400 ).json( { error: `Invalid input, expected an array of ipv4 addresses` } )
        }

        // Get the country of the ip addresses and save
        await Promise.all( ip_addresses.map( async ip => {
            
            try {
                const { default: geoip } = await import( 'geoip-lite' )
                const { country } = geoip.lookup( ip ) || {}
                if( !country ) throw new Error( `Could not find country for ip address ${ ip }` )
                await save_ip_address_and_return_ip_stats( { ip_address: ip, country, save_ip: true } )
            } catch ( e ) {
                log.info( `Error looking up ip address ${ ip }`, e )
            }

        } ) )


        return res.json( { success: true, ip_addresses } )

    }

    try {

        const retryable_handler = await make_retryable( handle_route, { retry_times: 2, cooldown_in_s: 10, cooldown_entropy: false } )
        return retryable_handler()
        
    } catch ( e ) {

        log.error( `Error handling miner ip submitted from other validator. Error:`, e )
        return res.status( 200 ).json( { error: e.message, score: 0, correct: false } )

    }
} )