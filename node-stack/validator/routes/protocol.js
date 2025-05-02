import { Router } from "express"
import { cache, log, make_retryable } from "mentie"
import { request_is_local } from "../modules/network.js"
export const router = Router()


router.post( "/broadcast/miners", async ( req, res ) => {

    // Make sure this request came from localhost
    if( !request_is_local( req ) ) return res.status( 403 ).json( { error: `Request not from localhost` } )

        
    const handle_route = async () => {

        // Get ip addresses from the request
        const { miners=[] } = req.body || {}

        // Validate that all miners have the { uid, ip } format where ip is regex matched as ipv4 naively
        if( !Array.isArray( miners ) || miners.length == 0 ) {
            log.warn( `No miner ips provided: `, req.body )
            throw new Error( `No miner ips provided` )
        }
        const valid_entries = miners.filter( entry => {
            const { uid, ip } = entry
            if( !uid || !ip ) return false
            const is_ipv4 = ip.match( /\d*.\d*.\d*.\d*/ )
            if( !is_ipv4 ) return false
            return true
        } )
        log.info( `Valid miner entries: ${ valid_entries.length }` )

        // If there are no valid entries, throw an error
        if( valid_entries.length == 0 ) throw new Error( `No valid miner ips provided` )

        // For each ip address, add the country
        const country_annotated_ips = await Promise.all( valid_entries.map( async miner => {

            try {

                const { default: geoip } = await import( 'geoip-lite' )
                const { country } = geoip.lookup( miner.ip ) || {}
                if( !country ) throw new Error( `Cannot determine country of ip ${ miner.ip }` )

                return { ...miner, country }

            } catch ( e ) {

                log.error( `Error looking up country for ip ${ miner.ip }`, e )
                return { ...miner, country: 'unknown' }

            }

        } ) )

        // Reduce the ip array to a mapping of ips to country and uid
        const ip_to_country = country_annotated_ips.reduce( ( acc, { ip, country, uid } ) => {
            acc[ ip ] = { country, uid }
            return acc
        }, {} )

        // Reduce the ip array to a mapping of country to count
        const country_count = country_annotated_ips.reduce( ( acc, { country } ) => {
            if( !acc[ country ] ) acc[ country ] = 1
            acc[ country ] += 1
            return acc
        } , {} )

        // Reduce the ip array to a mapping of country to ips
        const country_to_ips = country_annotated_ips.reduce( ( acc, { ip, country } ) => {
            if( !acc[ country ] ) acc[ country ] = []
            acc[ country ].push( ip )
            return acc
        }, {} )

        // Cache ip country data to memory
        log.info( `Caching ip to country data at key "ip_to_country"` )
        cache( `miner_ip_to_country`, ip_to_country )
        log.info( `Caching country count data at key "miner_country_count"` )
        cache( `miner_country_count`, country_count )
        log.info( `Caching country to ips data at key "miner_country_to_ips"` )
        cache( `miner_country_to_ips`, country_to_ips )

        return res.json( {
            ip_to_country,
            country_count,
            country_to_ips,
            success: true
        } )

    }

    try {

        const retryable_handler = await make_retryable( handle_route, { retry_times: 2, cooldown_in_s: 10, cooldown_entropy: false } )
        return retryable_handler()
        
    } catch ( e ) {

        log.warn( `Error handling miner ip submitted from neuron. Error:`, e )
        return res.status( 200 ).json( { error: e.message } )

    }
} )

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

router.get( "/sync/stats", ( req, res ) => {

    // Get relevant cache entries
    const miner_ip_to_country = cache( `miner_ip_to_country` ) || {}
    const miner_country_count = cache( `miner_country_count` ) || {}
    const miner_country_to_ips = cache( `miner_country_to_ips` ) || {}
    const last_known_validators = cache( 'last_known_validators' ) || []

    return res.json( {
        miner_ip_to_country,
        miner_country_count,
        miner_country_to_ips,
        last_known_validators,
        success: true
    } )

} )