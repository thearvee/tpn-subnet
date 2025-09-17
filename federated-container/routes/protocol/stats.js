import { Router } from "express"
import { get_complete_tpn_cache } from "../../modules/caching.js"

export const router = Router()

/**
 * Route to handle stats submitted from the neuron
 */
router.get( "/stats", ( req, res ) => {

    // Get tpn cache
    const tpn_cache = get_complete_tpn_cache()

    return res.json( tpn_cache )

} )