import { Router } from "express"
import { make_retryable } from "mentie"
import { cooldown_in_s, retry_times } from "../../modules/networking/routing.js"
import { get_tpn_cache } from "../../modules/caching.js"
import { country_name_from_code } from "../../modules/geolocation/helpers.js"
import { run_mode } from "../../modules/validations.js"


export const router = Router()

router.get( '/countries', async ( req, res ) => {

    const { format='json', type='code' } = req.query || {}

    const handle_route = async () => {


        // Validate inputs
        if( ![ 'json', 'text' ].includes( format ) ) throw new Error( `Invalid format: ${ format }` )
        if( ![ 'code', 'name' ].includes( type ) ) throw new Error( `Invalid type: ${ type }` )

        const worker_country_count = get_tpn_cache( 'worker_country_count' )
        const country_codes = Object.keys( worker_country_count )
        const country_names = country_codes.map( country_name_from_code )

        if( format == 'json' && type == 'code' ) return country_codes
        if( format == 'json' && type == 'name' ) return country_names
        if( format == 'text' && type == 'code' ) return country_codes.join( '\n' )
        if( format == 'text' && type == 'name' ) return country_names.join( '\n' )

    }

    try {
        const retryable_handler = await make_retryable( handle_route, { retry_times, cooldown_in_s } )
        const response_data = await retryable_handler()
        if( format == 'text' ) return res.send( response_data )
        return res.json( response_data )
    } catch ( error ) {
        return res.status( 500 ).json( { error: `Error handling new lease route: ${ error.message }` } )
    }
} )

router.get( '/stats', async ( req, res ) => {

    try {

        const { mode, validator_mode } = run_mode()
        const country_count = get_tpn_cache( 'country_count' )
        const country_code_to_ips = get_tpn_cache( 'country_code_to_ips' )
        const miner_uid_to_ip = validator_mode && get_tpn_cache( 'miner_uid_to_ip' )

        return res.json( { mode, country_count, country_code_to_ips, miner_uid_to_ip } )

    } catch ( error ) {
        return res.status( 500 ).json( { error: `Error handling stats route: ${ error.message }` } )
    }
} )
