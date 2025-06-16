import { Router } from "express"
import { cache, log, make_retryable, sanetise_string } from "mentie"
import { request_is_local } from "../modules/network.js"
import { save_balance } from "../modules/database.js"
import { get_complete_tpn_cache, save_tpn_cache_to_disk } from "../modules/caching.js"
export const router = Router()


/**
 * Route to handle miner ips submitted from the neuron
 */
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

        // Map ip to country into a mapping of uid to ip, and ip to uid
        const ip_to_uid = Object.keys( ip_to_country ).reduce( ( acc, ip ) => {
            const { country, uid } = ip_to_country[ ip ]
            acc[ ip ] = uid
            return acc
        }, {} )

        // Map uid to ip
        const uid_to_ip = Object.keys( ip_to_country ).reduce( ( acc, ip ) => {
            const { country, uid } = ip_to_country[ ip ]
            acc[ uid ] = ip
            return acc
        }, {} )

        // Reduce the ip array to a mapping of country to count
        const country_count = country_annotated_ips.reduce( ( acc, { country } ) => {
            if( !acc[ country ] ) acc[ country ] = 1
            else acc[ country ] += 1
            return acc
        } , {} )

        // Reduce the ip array to a mapping of country to ips
        const country_to_ips = country_annotated_ips.reduce( ( acc, { ip, country } ) => {
            if( !acc[ country ] ) acc[ country ] = []
            acc[ country ].push( ip )
            return acc
        }, {} )

        // For each country, list the miner uids in there
        const country_to_uids = country_annotated_ips.reduce( ( acc, { uid, country } ) => {
            if( !acc[ country ] ) acc[ country ] = []
            acc[ country ].push( uid )
            return acc
        }, {} )

        // Translate available country codes to full country names
        const region_names = new Intl.DisplayNames( [ 'en' ], { type: 'region' } )
        const country_codes = Object.keys( country_count )
        const country_code_to_name = country_codes.reduce( ( acc, code ) => {

            // Get the country name
            const name = sanetise_string( region_names.of( code ) )
            if( !name ) return acc
            acc[ code ] = name
            return acc
        }, {} )
        const country_name_to_code = country_codes.reduce( ( acc, code ) => {

            // Get country code
            const country_name = country_code_to_name[ code ]
            if( !country_name ) return acc
            acc[ country_name ] = code
            return acc

        }, {} )

        // Make a list of miner uids
        const miner_uids = country_annotated_ips.map( entry => entry.uid )


        // Cache ip country data to memory
        log.info( `Caching ip to country data at key "miner_ip_to_country"` )
        cache( `miner_ip_to_country`, ip_to_country )
        log.info( `Caching country count data at key "miner_country_count"` )
        cache( `miner_country_count`, country_count )
        log.info( `Caching country to ips data at key "miner_country_to_ips"` )
        cache( `miner_country_to_ips`, country_to_ips )
        log.info( `Caching country code to name data at key "miner_country_code_to_name":`, country_code_to_name.length )
        cache( `miner_country_code_to_name`, country_code_to_name )
        log.info( `Caching country name to code data at key "miner_country_name_to_code":`, country_name_to_code.length )
        cache( `miner_country_name_to_code`, country_name_to_code )
        log.info( `Caching miner uids to "miner_uids":`, miner_uids.length )
        cache( `miner_uids`, miner_uids )
        log.info( `Caching the country_to_uids list: `, Object.keys( country_to_uids ).length )
        cache( `miner_country_to_uids`, country_to_uids )
        log.info( `Caching ip to uid mapping at key "miner_ip_to_uid":`, Object.keys( ip_to_uid ).length )
        cache( `miner_ip_to_uid`, ip_to_uid )
        log.info( `Caching uid to ip mapping at key "miner_uid_to_ip":`, Object.keys( uid_to_ip ).length )
        cache( `miner_uid_to_ip`, uid_to_ip )

        // Persist cache to disk
        await save_tpn_cache_to_disk()

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

        // Persist cache to disk
        await save_tpn_cache_to_disk()

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

/**
 * Route to handle balances submitted from the neuron
 */
router.post( `/broadcast/balances/miners`, async ( req, res ) => {

    
    // Make sure this request came from localhost
    if( !request_is_local( req ) ) return res.status( 403 ).json( { error: `Request not from localhost` } )

    const handle_route = async () => {

        // Get balances from the request
        const { balances=[] } = req.body || {}

        // Validate that all balances have the { block, miner_uid, hotkey, balance } format
        if( !Array.isArray( balances ) || balances.length == 0 ) {
            log.warn( `No balances provided: `, req.body )
            throw new Error( `No balances provided` )
        }
        const valid_entries = balances.filter( entry => {
            const { block, miner_uid, hotkey, balance } = entry
            if( !block || !miner_uid || !hotkey || balance ) return false
            return true
        } )
        log.info( `Valid balance entries: ${ valid_entries.length }` )

        // If there are no valid entries, throw an error
        if( valid_entries.length == 0 ) throw new Error( `No valid balances provided` )

        // For each balance, save it to the database
        await Promise.all( valid_entries.map( async entry => save_balance( entry ) ) )
        log.info( `Saved ${ valid_entries.length } balances to database` )

        // Persist cache to disk
        await save_tpn_cache_to_disk()

        return res.json( {
            valid_entries,
            success: true
        } )

    }

    try {

        const retryable_handler = await make_retryable( handle_route, { retry_times: 2, cooldown_in_s: 10, cooldown_entropy: false } )
        return retryable_handler()
        
    } catch ( e ) {

        log.warn( `Error handling balances submitted from neuron. Error:`, e ) 
        return res.status( 200 ).json( { error: e.message } )

    }

} )

/**
 * Route to handle stats submitted from the neuron
 */
router.get( "/sync/stats", ( req, res ) => {

    // Get tpn cache
    const tpn_cache = get_complete_tpn_cache()

    return res.json( tpn_cache )

} )