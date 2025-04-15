import { Router } from "express"
export const router = Router()
import { log, require_props } from "mentie"
import { get_ips_by_country } from "../modules/database"

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

        // Get the miner ips for this country code
        const ips = await get_ips_by_country( { geo } )
        log.info( `Got ${ ips.length } ips for country:`, geo )

        // If there are no ips, return an error
        if( ips.length == 0 ) return res.status( 404 ).json( { error: `No ips found for country: ${ geo }` } )

        


    } catch ( e ) {

        return res.status( 400 ).json( { error: e.message } )

    }

} )