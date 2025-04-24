import { Router } from "express"
export const router = Router()
import { score_request_uniqueness } from "../modules/scoring.js"
import { cache, log } from "mentie"
import { get_miner_stats } from "../modules/stats.js"

// Scoring route
router.get( "/", async ( req, res ) => {

    try {

        const score = await score_request_uniqueness( req, { save_ip: false } )

        return res.json( { score } )
        
    } catch ( e ) {

        log.error( e )
        return res.status( 500 ).json( { error: e.message } )

    }

} )

// Stats route
router.get( "/stats", async ( req, res ) => {

    try {

        // Check if we have cached data
        let stats = cache(  'miner_stats' )
        if( stats ) return res.json( stats )

        // Cache stats
        stats = await get_miner_stats()
        cache( `miner_stats`, stats, 60_000 )

        return res.json( stats )
        
    } catch ( e ) {

        log.error( e )
        return res.status( 500 ).json( { error: e.message } )

    }

} )

router.get( "/stats/miners", async ( req, res ) => {

    try {

        // Check if we have cached data
        const stats = cache( 'last_known_miner_scores' ) || {}
        return res.json( stats )

    } catch ( e ) {

        log.error( e )
        return res.status( 500 ).json( { error: e.message } )

    }

} )