import { Router } from "express"
import { generate_challenge, solve_challenge } from "../modules/challenge.js"
import { score_request_uniqueness } from "../modules/scoring.js"
import { get_challenge_response } from "../modules/database.js"
import { cache, log } from "mentie"
export const router = Router()

// Generate challenge route
router.get( "/new", async ( req, res ) => {

    // Generate a new challenge
    const challenge = await generate_challenge()

    // Formulate public challenge URL
    const { PUBLIC_URL } = process.env
    const challenge_url = `${ PUBLIC_URL }/challenge/${ challenge }`

    return res.json( { challenge, challenge_url } )

} )

// Challenge solution route
router.get( "/:challenge/:response?", async ( req, res ) => {

    // Extract challenge and response from request
    const { challenge, response } = req.params

    // If only the challenge is provided, return the response
    if( !response ) {

        const cached_value = cache( `challenge_solution_${ challenge }` )
        if( cached_value ) return res.json( { response: cached_value.response } )

        const challenge_response = await get_challenge_response( { challenge } )
        if( !cached_value ) cache( `challenge_solution_${ challenge }`, challenge_response )

        log.info( `Returning challenge response for challenge ${ challenge }` )
        return res.json( { response: challenge_response.response } )

    }

    // Check for cached value
    const cached_value = cache( `solution_score_${ challenge }` )
    if( cached_value ) {
        log.info( `Returning cached value for solution ${ challenge }` )
        return res.json( cached_value )
    }

    // Validate the response
    const { correct, ms_to_solve, solved_at } = await solve_challenge( { challenge, response } )

    // If not correct, return false
    if( !correct ) return res.json( { correct } )

    // If correct, score the request
    const uniqueness_score = await score_request_uniqueness( req )

    // Score based on delay, with a grace period, and a punishment per ms above it
    log.info( `Time to solve ${ challenge }: ${ ms_to_solve } (${ solved_at })` )
    const s_to_solve = ms_to_solve / 1000
    const penalty = Math.min( 100, 2 ** s_to_solve - 1 )
    const speed_score = 100 - penalty

    // Composite score, average of uniqueness and speed
    const score = Math.round( ( uniqueness_score + speed_score ) / 2 )

    // Formulate and cache response
    const data = { correct, score, speed_score, uniqueness_score, solved_at }
    cache( `solution_score_${ challenge }`, data )

    return res.json( data )

} )