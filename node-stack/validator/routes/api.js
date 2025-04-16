import { Router } from "express"
export const router = Router()
import { cache, log, require_props } from "mentie"
import { get_ips_by_country, get_miner_stats } from "../modules/database.js"
import fetch from "node-fetch"

router.get( "/config/countries", async ( req, res ) => {

    try {

        // Check if we have cached data
        let country_codes = cache(  'country_code_stats' )
        if( country_codes ) return res.json( country_codes )

        // Cache stats
        const stats = await get_miner_stats()
        country_codes = Object.keys( stats )
        log.info( `country_code_stats`, country_codes, 60_000 )

        return res.json( [ country_codes ] )
        
    } catch ( e ) {

        log.error( e )
        return res.status( 500 ).json( { error: e.message } )

    }

} )

router.get( '/config/new', async ( req, res ) => {

    try {

        // Get request parameters
        let { geo, lease_minutes } = req.query
        log.info( `Request received for new config:`, { geo, lease_minutes } )

        // Validate request parameters
        const required_properties = [ 'geo', 'lease_minutes' ]
        require_props( req.query, required_properties )
        log.info( `Request properties validated` )

        // Validate lease
        const lease_min = .5
        const lease_max = 60
        if( lease_minutes < lease_min || lease_minutes > lease_max ) {
            throw new Error( `Lease must be between ${ lease_min } and ${ lease_max } minutes, you supplied ${ lease_minutes }` )
        }

        // If geo was set to 'any', set it to null
        if( geo == 'any' ) geo = null

        // Dummy response
        const live = true
        if( !live ) {
            return res.json( { error: 'Endpoint not yet enabled, it will be soon', your_inputs: { geo, lease_minutes } } )
        }

        // Get the miner ips for this country code
        const ips = await get_ips_by_country( { geo } )
        log.info( `Got ${ ips.length } ips for country:`, geo )

        // If there are no ips, return an error
        if( ips.length == 0 ) return res.status( 404 ).json( { error: `No ips found for country: ${ geo }` } )

        // Request configs from these miners until one succeeds
        let config = null
        for( const ip of ips ) {

            log.info( `Requesting config from miner:`, ip )

            // Create the config url
            let config_url = new URL( `http://${ ip }:3000/wireguard/new` )
            config_url.searchParams.set( 'lease_minutes', lease_minutes )
            config_url.searchParams.set( 'geo', geo )
            config_url = config_url.toString()
            log.info( `Requesting config from:`, config_url )

            // Response holder for trycatch management
            let response = undefined

            try {

                // Get the config file from the miner
                response = await fetch( config_url )
                const json = await response.clone().json()
                log.info( `Response from ${ ip }:`, json )

                // Get relevant properties
                const { peer_config, expires_at } = json
                if( peer_config && expires_at ) config = { peer_config, expires_at }

                // If we have a config, exit the for loop
                if( config ) break

            } catch ( e ) {

                const text_response = await response?.clone()?.text()?.catch( e => e.message )
                log.info( `Error requesting config from ${ ip }: ${ e.message }. Response body:`, text_response )
                continue

            }


        }

        // If no config was found, return an error 
        if( !config ) return res.status( 404 ).json( { error: `No config found for country: ${ geo }` } )
        log.info( `Config found for ${ geo }:`, config )

        // Return the config to the requester
        return res.json( { ...config } )


    } catch ( e ) {

        log.info( `Error requesting config:`, e.message )
        return res.status( 400 ).json( { error: e.message } )

    }

} )
