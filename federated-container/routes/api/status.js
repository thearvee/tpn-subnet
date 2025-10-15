import { Router } from "express"
import { cache, log, make_retryable } from "mentie"
import { cooldown_in_s, retry_times } from "../../modules/networking/routing.js"
import { get_tpn_cache } from "../../modules/caching.js"
import { country_name_from_code } from "../../modules/geolocation/helpers.js"
import { run_mode } from "../../modules/validations.js"
import { get_worker_performance, get_workers } from "../../modules/database/workers.js"
import { writeToString } from "@fast-csv/format"

export const router = Router()

router.get( '/countries', async ( req, res ) => {

    const { format='json', type='code' } = req.query || {}

    const handle_route = async () => {


        // Validate inputs
        if( ![ 'json', 'text' ].includes( format ) ) throw new Error( `Invalid format: ${ format }` )
        if( ![ 'code', 'name' ].includes( type ) ) throw new Error( `Invalid type: ${ type }` )

        const worker_country_count = get_tpn_cache( 'worker_country_count', {} )
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
        return res.status( 500 ).json( { error: `Error handling stats route: ${ error.message }` } )
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

router.get( '/worker_performance', async ( req, res ) => {

    try {

        // Get request params
        let { from, to, format='json', api_key } = req.query || {}

        // Check request validity
        const { miner_mode } = run_mode()
        if( !miner_mode ) return res.status( 403 ).json( { error: `Performance data is only available in miner mode` } )
        const { ADMIN_API_KEY } = process.env
        if( ADMIN_API_KEY && api_key !== ADMIN_API_KEY ) return res.status( 403 ).json( { error: `Invalid API key` } )

        // If no admin API key was set, warn
        log.warn( `No ADMIN_API_KEY set in environment, this is a security risk and should be set in production` )

        // Check for response cache
        const cached_response = cache( `worker_performance_${ from }_${ to }_${ format }` )
        if( cached_response ) {
            log.info( `Returning cached response for worker performance from ${ from } to ${ to } in format ${ format }` )
            if( format === 'json' ) return res.json( cached_response )
            if( format === 'csv' ) return res.type( 'text/csv' ).send( cached_response )
        }

        // If the from and to values are timestamps, keep them, if strings, parse to timestamps
        if( from && isNaN( Number( from ) ) ) from = Date.parse( from )
        if( to && isNaN( Number( to ) ) ) to = Date.parse( to )
        
        // If parsing failed, return with invalid date error
        if( from && isNaN( from ) ) return res.status( 400 ).json( { error: `Invalid 'from' date` } )
        if( to && isNaN( to ) ) return res.status( 400 ).json( { error: `Invalid 'to' date` } )

        // Get the relevant worker data
        let { success, workers } = await get_worker_performance( { from, to } )
        if( !success ) throw new Error( `Error fetching worker performance data` )

        // Annotate workers with payment data
        workers = await Promise.all( workers.map( async worker => {
            const cached_metadata = cache( `worker_metadata_${ worker.ip }` )
            if( cached_metadata ) return { ...worker, ...cached_metadata }
            const metadata = await get_workers( { ip: worker.ip } )
            cache( `worker_metadata_${ worker.ip }`, metadata.workers?.[0], 10_000 )
            return { ...worker, ...metadata }
        } ) )

        // Collate data into scores
        workers = workers.reduce( ( acc, { ip, status } ) => {

            // Increment status scores
            const history = acc[ ip ] || { up: 0, down: 0, unknown: 0, uptime: 0 }
            acc[ ip ] = { ...history, [ status ]: history[ status ] + 1 }
            
            // Increment total uptime
            const { up, down, unknown } = acc[ ip ]
            const uptime = Math.round(  up / ( up + down + unknown )  * 10000 ) / 100
            acc[ ip ].uptime = isNaN( uptime ) ? 0 : uptime

            return acc

        }, {} )

        // Turn into array sorted by uptime
        workers = Object.entries( workers ).map( ( [ ip, data ] ) => ( { ip, ...data } ) ).sort( ( a, b ) => b.uptime - a.uptime )

        // Cache response for 5 minutes
        cache( `worker_performance_${ from }_${ to }_${ format }`, workers, 5 * 60_000 )

        // Return in the requested format
        if( format === 'json' ) {
            return res.json( workers )
        } else if( format === 'csv' ) {
            const csv = await writeToString( workers, { header: true } )
            return res.type( 'text/csv' ).send( csv )
        }

        // Fall back to json
        return res.json( workers )

    } catch ( error ) {
        return res.status( 500 ).json( { error: `Error handling performance route: ${ error.message }` } )
    }
} )
