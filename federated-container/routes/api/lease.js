import { Router } from "express"
import { allow_props, is_ipv4, log, make_retryable, require_props, sanetise_ipv4, sanetise_string } from "mentie"
import { cooldown_in_s, retry_times } from "../../modules/networking/routing.js"
import { run_mode } from "../../modules/validations.js"
import { get_tpn_cache } from "../../modules/caching.js"
import { get_worker_config_as_miner } from "../../modules/api/mining_pool.js"
import { get_worker_config_as_validator } from "../../modules/api/validator.js"
import { get_worker_config_as_worker } from "../../modules/api/worker.js"
import { is_validator_request } from "../../modules/networking/validators.js"
import { ip_from_req, resolve_domain_to_ip } from "../../modules/networking/network.js"
import { MINING_POOL_URL } from "../../modules/networking/worker.js"
import { country_name_from_code } from "../../modules/geolocation/helpers.js"
import { get_worker_countries_for_pool } from "../../modules/database/workers.js"
const { CI_MOCK_WORKER_RESPONSES } = process.env

export const router = Router()

router.get( [ '/config/new', '/lease/new' ], async ( req, res ) => {

    const { format='json' } = req.query || {}

    const handle_route = async () => {

        // Caller validation based on run mode
        const { mode, worker_mode, miner_mode, validator_mode } = run_mode()
        if( miner_mode ) {
            const is_validator = await is_validator_request( req )
            if( !is_validator ) {
                const { unspoofable_ip } = ip_from_req( req )
                throw new Error( `Miners only accept lease requests from validators, which you (${ unspoofable_ip }) are not` )
            }
        }

        // Worker access controls
        if( worker_mode && !CI_MOCK_WORKER_RESPONSES ) {
            log.info( `Checking if caller is mining pool: ${ MINING_POOL_URL }` )
            const { hostname } = new URL( MINING_POOL_URL )
            let { unspoofable_ip } = ip_from_req( req )
            const { ip: mining_pool_ip } = await resolve_domain_to_ip( { domain: hostname } )
            const ip_match = sanetise_ipv4( { ip: unspoofable_ip } ) === sanetise_ipv4( { ip: mining_pool_ip } )
            if( !ip_match ) {
                log.warn( `Attempted access denied for ${ mining_pool_ip }` )
                throw new Error( `Worker does not accept lease requests from ${ unspoofable_ip }` )
            }
        }

        // 📋 Future: Validator access controls
        // if( validator_mode && !payment )

        // Prepare validation props based on run mode
        const mandatory_props = [ 'lease_seconds', 'format' ]
        const optional_props = [ 'geo', 'whitelist', 'blacklist', 'priority' ]
        // if( worker_mode ) mandatory_props = worker_props
        // if( validator_mode ) mandatory_props = val_props
        // if( miner_mode ) mandatory_props = pool_props

        // Get all relevant data
        require_props( req.query, mandatory_props, true )
        allow_props( req.query, [ ...mandatory_props, ...optional_props ], true )
        let { lease_seconds, lease_minutes, format, geo='any', whitelist, blacklist, priority=false } = req.query
        const available_countries = await get_worker_countries_for_pool()

        // Backwards compatibility
        if( !lease_seconds && lease_minutes ) {
            const _lease_seconds = Number( lease_minutes ) * 60
            lease_seconds = _lease_seconds
            log.info( `Deprecation warning: lease_minutes is deprecated, use lease_seconds instead, converting ${ lease_minutes } minutes to ${ _lease_seconds } seconds` )
        }

        // Sanetise and parse inputs for each prop set
        lease_seconds = lease_seconds && parseInt( lease_seconds, 10 )
        format = format && sanetise_string( format )
        geo = geo && `${ sanetise_string( geo ) }`.toUpperCase()
        whitelist = whitelist && sanetise_string( whitelist ).split( ',' )
        blacklist = blacklist && sanetise_string( blacklist ).split( ',' )
        priority = priority === 'true'
        const config_meta = { lease_seconds, format, geo, whitelist, blacklist, priority }

        // Validate inputs as specified in props
        const geo_available = [ ...available_countries, 'ANY' ].includes( geo )
        if( !geo_available ) log.debug( `No workers found for geo: ${ geo } in `, available_countries )
        if( !lease_seconds || isNaN( lease_seconds ) ) throw new Error( `Invalid lease_seconds: ${ lease_seconds }` )
        if( format?.length && ![ 'json', 'text' ].includes( format ) ) throw new Error( `Invalid format: ${ format }` )
        if( geo?.length && !geo_available ) throw new Error( `No workers found for geo: ${ geo }.` )
        if( whitelist?.length && whitelist.some( ip => !is_ipv4( ip ) ) ) throw new Error( `Invalid ip addresses in whitelist` )
        if( blacklist?.length && blacklist.some( ip => !is_ipv4( ip ) ) ) throw new Error( `Invalid ip addresses in blacklist` )

        // Get relevant config based on run mode
        log.debug( `Getting config as ${ mode } with params:`, config_meta )
        let config = null
        if( validator_mode ) config = await get_worker_config_as_validator( config_meta )
        if( miner_mode ) config = await get_worker_config_as_miner( config_meta )
        if( worker_mode ) config = await get_worker_config_as_worker( config_meta )

        // Validate config
        if( !config ) throw new Error( `${ mode } failed to get config for ${ geo }` )

        return config

    }

    try {
        const retryable_handler = await make_retryable( handle_route, { retry_times, cooldown_in_s } )
        const response_data = await retryable_handler()
        return format == 'text' ? res.send( response_data ) : res.json( response_data )
    } catch ( e ) {
        log.info( `Error handling new lease route: ${ e.message }` )
        return res.status( 500 ).json( { error: `Error handling new lease route: ${ e.message }` } )
    }
} )


router.get( [ '/config/countries', '/lease/countries' ], async ( req, res ) => {

    const { format='json', type='code' } = req.query || {}

    const handle_route = async () => {


        // Validate inputs
        if( ![ 'json', 'text' ].includes( format ) ) throw new Error( `Invalid format: ${ format }` )
        if( ![ 'code', 'name' ].includes( type ) ) throw new Error( `Invalid type: ${ type }` )

        const country_codes = await get_worker_countries_for_pool()
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