import { Router } from 'express'
import { log, make_retryable } from 'mentie'
import { cooldown_in_s, retry_times } from "../../modules/networking/routing.js"


const router = Router()

router.post( '/workers', async ( req, res ) => {

    const handle_route = async () => {

        // Get neurons from the request
        const { neurons=[] } = req.body || {}

    }

    try {

        const retryable_handler = await make_retryable( handle_route, { retry_times, cooldown_in_s } )
        const response_data = await retryable_handler()
        return res.json( response_data )
 
    } catch ( e ) {
        
        log.warn( `Error handling neuron broadcast. Error:`, e )
        return res.status( 200 ).json( { error: e.message } )

    }
} )