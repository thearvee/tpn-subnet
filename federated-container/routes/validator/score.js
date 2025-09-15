import { Router } from "express"
import { score_mining_pools } from "../../modules/scoring/score_mining_pools.js"
import { cache, log } from "mentie"
import { get_pool_scores } from "../../modules/database/mining_pools.js"


export const router = Router()

router.get( "/force", async ( req, res ) => {

    // Endpoint may only be called is CI_MODE is on
    const { CI_MODE, CI_MOCK_WORKER_RESPONSES, CI_MOCK_MINING_POOL_RESPONSES } = process.env
    log.info( `Received force request`, { CI_MODE, CI_MOCK_WORKER_RESPONSES, CI_MOCK_MINING_POOL_RESPONSES } )
    if( CI_MODE !== 'true' ) {
        return res.status( 403 ).json( { error: "CI_MODE is not enabled" } )
    }

    // Force score all mining pools
    log.info( `Forcing scoring for validator` )
    const results = await score_mining_pools()
    log.info( `Completed forced scoring for validator`, results )
    return res.json( results )

} )

router.get( '/mining_pools', async ( req, res ) => {

    // Check for cached value
    const cached_scores = cache( 'mining_pool_scores' ) || {} 
    if( cached_scores ) return cached_scores

    // Get updated scores
    const { scores } = await get_pool_scores()

    // Cache and return scores
    return cache( 'mining_pool_scores', scores, 5_000 )
    
} )