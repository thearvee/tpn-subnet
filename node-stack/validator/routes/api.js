import { Router } from "express"
export const router = Router()
import { log, require_props } from "mentie"
import { get_ips_by_country } from "../modules/database"
import fetch from "node-fetch"

router.get( '/config/new', async ( req, res ) => {

    try {

        // Get request parameters
        const { geo, lease_minutes } = req.query
        log.info( `Request received for new config:`, { geo, lease_minutes } )

        // Validate request parameters
        const required_properties = [ 'geo', 'lease_minutes' ]
        require_props( req.query, required_properties )

        // Validate lease
        const lease_min = 5
        const lease_max = 60
        if( lease_minutes < lease_min || lease_minutes > lease_max ) {
            throw new Error( `Lease must be between ${ lease_min } and ${ lease_max } minutes, you supplied ${ lease_minutes }` )
        }

        // Dummy response
        const live = false
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

            // Create the config url
            let config_url = new URL( `http://${ ip }:3000/wireguard/new?` )
            config_url.searchParams.set( 'lease_minutes', lease_minutes )
            config_url.searchParams.set( 'geo', geo )
            config_url = config_url.toString()
            log.info( `Requesting config from:`, config_url )

            try {

                const response = await fetch( config_url )
                const json = await response.json()
                log.info( `Response from ${ ip }:`, json )

                // Get relevant properties
                const { peer_config, expires_at } = json
                if( peer_config && expires_at ) config = { peer_config, expires_at }

            } catch ( e ) {

                log.info( `Error requesting config from ${ ip }:`, e )
                continue

            }


        }

        // If no config was found, return an error 
        if( !config ) return res.status( 404 ).json( { error: `No config found for country: ${ geo }` } )
        log.info( `Config found for ${ geo }:`, config )

        // Return the config to the requester
        return res.json( { ...config } )


    } catch ( e ) {

        return res.status( 400 ).json( { error: e.message } )

    }

} )