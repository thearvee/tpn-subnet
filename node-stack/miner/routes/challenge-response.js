import { Router } from 'express'
import { log, make_retryable } from 'mentie'
import fetch from 'node-fetch'
export const router = Router()

router.post( '/', async ( req, res ) => {

    const handle_route = async () => {

        // Get url paramater from post request
        const { url } = req.body
        log.info( `Received url: ${ url }` )
            
        // Check if the url is valid
        if( !url ) return res.status( 400 ).send( 'No url provided' )
        if( !url.startsWith( 'http' ) ) return res.status( 400 ).send( 'Invalid url' )
            
        // Get the { response } from the url body
        const response_to_challenge = await fetch( url )
        const { response } = await response_to_challenge.json()
        log.info( `Response from ${ url }: ${ response }` )
            
        // Call the challenge-response API
        const solution_url = `${ url }/${ response }`
        log.info( `Calling solution: ${ solution_url }` )
        const solution_res = await fetch( solution_url )
        const score = await solution_res.json()
        log.info( `Solution score:`, score )
            
        // Send the score back to the client
        return res.json( { ...score, response } )

    }

    try {

        const retryable_handler = await make_retryable( handle_route, { retry_times: 10, cooldown_in_s: 5, cooldown_entropy: true } )
        return retryable_handler()

    } catch ( error ) {
        log.error( `Error in challenge-response: ${ error }` )
        return res.status( 500 ).send( 'Internal server error' )
    }

} )

router.get( '/', ( req, res ) => res.send( 'Challenge-response router' ) )