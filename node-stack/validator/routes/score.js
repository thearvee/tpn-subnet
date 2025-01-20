import { Router } from "express"
export const router = Router()
import { score_request_uniqueness } from "../modules/scoring.js"

// Scoring route
router.get( "/", async ( req, res ) => {

    const score = await score_request_uniqueness( req )

    return res.json( { score } )

} )