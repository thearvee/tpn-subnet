import { Router } from "express"
import { generate_challenge, solve_challenge } from "../modules/challenge.js"
import { score_request_uniqueness } from "../modules/scoring.js"
import { cache, log, make_retryable } from "mentie"
import { base_url } from "../modules/url.js"
import { validate_wireguard_config } from "../modules/wireguard.js"
import { get_challenge_response_score, save_challenge_response_score } from "../modules/database.js"
export const router = Router()
const { CI_MODE } = process.env

// Generate challenge route
router.get( "/new", async ( req, res ) => {

    try {

        // Get miner uid from get query
        const { miner_uid } = req.query

        // Generate a new challenge
        const challenge = await generate_challenge( { miner_uid } )
        log.info( `New challenge generated for ${ miner_uid }:`, { challenge } )

        // Formulate public challenge URL
        const challenge_url = `${ base_url }/challenge/${ challenge }`

        return res.json( { challenge, challenge_url } )

    } catch ( e ) {

        log.error( e )
        return res.status( 200 ).json( { error: e.message } )

    }

} )

// Challenge route to get but not solve challenge/responses
// :challenge only - return the response for the challenge
// :challenge and :response - validate the response and return the score
router.get( "/:challenge/:response?", async ( req, res ) => {

    const handle_route = async () => {

        // Extract challenge and response from request
        const { challenge, response } = req.params
        log.info( `Score requested for challenge ${ challenge }/${ response }` )

        // If only the challenge is provided, return the response
        if( !response ) return res.json( { error: `This endpoint is to get scores, not solve challenges` } )

        // Check for cached value
        const cached_value = cache( `solution_score_${ challenge }` )
        if( cached_value ) {
            log.info( `Returning cached value for solution ${ challenge }` )
            return res.json( cached_value )
        }

        // Get score from database
        const data = await get_challenge_response_score( { challenge } )

        // Cache it
        if( data ) cache( `solution_score_${ challenge }`, data, 60 * 60 * 24 )
        log.info( `Returning score for ${ challenge }:`, data )
        if( !data ) return res.status( 200 ).json( { error: `Challenge not found`, score: 0 } )

        return res.json( data )

    }

    try {

        const retryable_handler = await make_retryable( handle_route, { retry_times: 2, cooldown_in_s: 10, cooldown_entropy: false } )
        return retryable_handler()
        
    } catch ( e ) {

        log.error( `Error handling challenge/response routes, returning error response. Error:`, e )
        return res.status( 200 ).json( { error: e.message, score: 0 } )

    }
} )

// Wireguard challenge response route
// :challenge only - return the response for the challenge
// :challenge and :response - validate the response and return the score, expects a wireguard_config object in the request body
router.post( "/:challenge/:response", async ( req, res ) => {

    const handle_route = async () => {


        // Extract challenge and response from request
        const { challenge, response } = req.params
        if( !challenge || !response ) return res.status( 400 ).json( { error: 'Missing challenge or response' } )

        // Extact wireguard config from request
        const { wireguard_config={} } = req.body || {}
        const { peer_config, peer_id, peer_slots, expires_at } = wireguard_config

        // Validate existence of wireguard config fields
        if( !peer_config || !peer_id || !peer_slots || !expires_at ) {
            log.info( `Bad challenge/response ${ challenge }/${ response } with body:`, req.body )
            return res.status( 200 ).json( { error: 'Missing wireguard config fields', score: 0, correct: false } )
        }

        // Validate the challenge solution
        log.info( `Validating challenge solution for ${ challenge }/${ response }` )
        const { correct, ms_to_solve, solved_at } = await solve_challenge( { challenge, response } )

        // If not correct, return false
        if( !correct ) return res.json( { correct } )

        // If correct, score the request
        const { uniqueness_score, country_uniqueness_score } = await score_request_uniqueness( req )
        if( uniqueness_score === undefined ) {
            log.info( `Uniqueness score is undefined, returning error` )
            return res.status( 200 ).json( { error: 'Nice try', correct: false, score: 0 } )
        }

        // Upon solution success, test the wireguard config
        const { valid: wireguard_valid, message='Unknown error validating wireguard config' } = await validate_wireguard_config( { peer_config, peer_id } )
        if( !wireguard_valid ) {
            log.info( `Wireguard config for peer ${ peer_id } failed challenge` )
            return res.json( { message, correct: false, score: 0 } )
        }

        // Score based on delay, with a grace period, and a punishment per ms above it
        log.info( `Time to solve ${ challenge }: ${ ms_to_solve } (${ solved_at })` )
        const s_to_solve = ms_to_solve / 1000
        const grace_secs = 45
        const penalty = Math.min( 100, 1.1 ** ( grace_secs - s_to_solve ) )
        const speed_score = Math.sqrt( 100 - penalty )

        // Uniqeness score, minus maximum speed score, plus speed score
        const score = Math.max( Math.round( uniqueness_score - 10 + speed_score ), 0 )

        // Formulate and cache response
        const data = { correct, score, speed_score, uniqueness_score, country_uniqueness_score, solved_at }
        cache( `solution_score_${ challenge }`, data )
        
        // Save score to database
        await save_challenge_response_score( { correct, challenge, score, speed_score, uniqueness_score, country_uniqueness_score, solved_at } )
        log.info( `Challenge ${ challenge } solved with score ${ score }` )

        return res.json( data )

    }

    try {

        const retryable_handler = await make_retryable( handle_route, { retry_times: 2, cooldown_in_s: 10, cooldown_entropy: false } )
        return retryable_handler()
        
    } catch ( e ) {

        log.error( `Error handling challenge/response routes, returning error response. Error:`, e )
        return res.status( 200 ).json( { error: e.message, score: 0, correct: false } )

    }
} )