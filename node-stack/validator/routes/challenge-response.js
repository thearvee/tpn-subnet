import { Router } from "express"
import { generate_challenge, solve_challenge } from "../modules/challenge.js"
import { score_request_uniqueness } from "../modules/scoring.js"
import { cache, log, make_retryable } from "mentie"
import { base_url } from "../modules/url.js"
import { validate_wireguard_config } from "../modules/wireguard.js"
import { get_challenge_response, get_challenge_response_score, save_challenge_response_score } from "../modules/database.js"
import { ip_from_req } from "../modules/network.js"
export const router = Router()
const { CI_MODE } = process.env

// Generate challenge route
router.get( "/new", async ( req, res ) => {

    try {

        // Get miner uid from get query
        const { miner_uid='unknown' } = req.query

        // Generate a new challenge
        const challenge = await generate_challenge( { miner_uid } )

        // Formulate public challenge URL
        let challenge_url = new URL( base_url )
        challenge_url.pathname = `/challenge/${ challenge }`
        challenge_url.searchParams.set( 'miner_uid', miner_uid )
        challenge_url = challenge_url.toString()
        log.info( `New challenge url generated: ${ challenge_url }` )

        return res.json( { challenge, challenge_url } )

    } catch ( e ) {

        log.error( e )
        return res.status( 200 ).json( { error: e.message } )

    }

} )

// Scoring helper
const calculate_score = ( { uniqueness_score, ms_to_solve } ) => {

    // Score based on delay, with a grace period, and a punishment per ms above it
    const s_to_solve = ms_to_solve / 1000
    const grace_secs = 45
    const penalty = Math.min( 100, 1.1 ** ( grace_secs - s_to_solve ) )
    const speed_score = Math.sqrt( 100 - penalty )
    
    // Uniqeness score, minus maximum speed score, plus speed score
    // const score = Math.max( Math.round( uniqueness_score - 10 + speed_score ), 0 )

    // The speed score is causing discrepancies between validators, we will disable it for now
    const score = Math.round( uniqueness_score )
            
    return { score, speed_score }

}

// Challenge route, used by validator when validating challenge/responses through wireguard connection
// :challenge only - return the response for the challenge
// :challenge and :response - validate the response and return the score
// NOTE: this pathway does not solve anything. This is checked in validate_wireguard_config()
router.get( "/:challenge/:response?", async ( req, res ) => {

    const handle_route = async () => {

        // Extract challenge and response from request
        const { miner_uid } = req.query
        const { challenge, response } = req.params
        log.info( `[GET] Challenge/response ${ challenge }/${ response || '' } called by ${ miner_uid ? 'validator' : 'miner' }` )

        /* /////////////////////////////
        //  Path 1: solving a challenge
        // ////////////////////////// */

        // If only the challenge is provided, return the response
        // this is hit when solving a GET challenge, the validator and miner both hit this
        if( !response ) {

            const cached_value = cache( `challenge_solution_${ challenge }` )
            if( cached_value ) {
                log.info( `[GET] Returning cached value (no response provided) for challenge ${ challenge }: `, cached_value )
                return res.json( { response: cached_value.response } )
            }

            const challenge_response = await get_challenge_response( { challenge } )
            if( !cached_value && challenge_response.response ) cache( `challenge_solution_${ challenge }`, challenge_response )

            log.info( `[GET] Returning challenge response for challenge ${ challenge }: `, challenge_response )
            return res.json( { ...challenge_response } )

        }

        /* /////////////////////////////
        //  Path 2: checking solution score
        // ////////////////////////// */

        // Check for cached value
        const cached_value = cache( `solution_score_${ challenge }` )
        if( cached_value ) {
            log.info( `[GET] Returning cached value for solution ${ challenge }` )
            return res.json( cached_value )
        }

        // Check for solved value
        log.info( `[GET] Checking for scored response in database for ${ challenge }` )
        const scored_response = await get_challenge_response_score( { challenge } )
        if( scored_response && !scored_response.error ) {
            log.info( `[GET] Returning scored value for solution ${ challenge }` )
            cache( `solution_score_${ challenge }`, scored_response )
            return res.json( scored_response )
        }

        /* /////////////////////////////
        //  Path 3: no known score
        // ////////////////////////// */
        return res.json( { error: 'No known score for this challenge' } )

        // // Validate the response
        // const { correct, ms_to_solve, solved_at } = await solve_challenge( { challenge, response } )

        // // If not correct, return false
        // if( !correct ) return res.json( { correct } )

        // // If correct, score the request
        // const { uniqueness_score, country_uniqueness_score } = await score_request_uniqueness( req )
        // log.info( `[GET] Uniqueness score for ${ challenge }: ${ uniqueness_score }` )
        // if( uniqueness_score === undefined && !CI_MODE ) {
        //     log.info( `Uniqueness score is undefined, returning error` )
        //     return res.status( 200 ).json( { error: 'Nice try', score: 0, correct: false } )
        // }

        // // Calculate the score
        // log.info( `[GET] Time to solve ${ challenge }: ${ ms_to_solve } (${ solved_at })` )
        // const { score, speed_score } = calculate_score( { uniqueness_score, ms_to_solve } )

        // // Formulate and cache response
        // const data = { correct, score, speed_score, uniqueness_score, country_uniqueness_score, solved_at, miner_uid }
        // await save_challenge_response_score( { correct, challenge, score, speed_score, uniqueness_score, country_uniqueness_score, solved_at } )
        // log.info( `[GET] Challenge ${ challenge } solved with score ${ score }` )
        // cache( `solution_score_${ challenge }`, data )

        // return res.json( data )

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
        const { miner_uid } = req.query
        const { challenge, response } = req.params
        if( !challenge || !response ) return res.status( 400 ).json( { error: 'Missing challenge or response' } )

        // Extact wireguard config from request
        const { wireguard_config={} } = req.body || {}
        const { peer_config, peer_id, peer_slots, expires_at } = wireguard_config

        // Validate existence of wireguard config fields
        if( !peer_config || !peer_id || !peer_slots || !expires_at ) {
            log.info( `[POST] Bad challenge/response ${ challenge }/${ response } with body:`, req.body )
            return res.status( 200 ).json( { error: 'Missing wireguard config fields', score: 0, correct: false } )
        }

        // Validate the challenge solution
        log.info( `[POST] Validating challenge solution for ${ challenge }/${ response }` )
        const { correct, ms_to_solve, solved_at } = await solve_challenge( { challenge, response } )

        // If not correct, return false
        if( !correct ) return res.json( { correct } )

        // Get ip from request
        const { unspoofable_ip, spoofable_ip } = ip_from_req( req )

        // Upon solution success, test the wireguard config
        const { valid: wireguard_valid, message='Unknown error validating wireguard config' } = await validate_wireguard_config( { peer_config, peer_id, miner_ip: unspoofable_ip } )
        if( !wireguard_valid ) {
            log.info( `[POST] Wireguard config for peer ${ peer_id } failed challenge` )
            return res.json( { message, correct: false, score: 0 } )
        }

        // If correct, score the request
        const { uniqueness_score, country_uniqueness_score, details } = await score_request_uniqueness( req )
        if( uniqueness_score === undefined ) {
            log.info( `[POST] Uniqueness score is undefined, returning error` )
            return res.status( 200 ).json( { error: 'Nice try', correct: false, score: 0 } )
        }

        // Calculate the score
        log.info( `Time for miner ${ miner_uid } to solve ${ challenge }: ${ ms_to_solve } (${ solved_at })` )
        const { score, speed_score } = calculate_score( { uniqueness_score, ms_to_solve } )

        // Formulate and cache response
        const data = { correct, score, speed_score, uniqueness_score, country_uniqueness_score, solved_at, miner_uid }
        cache( `solution_score_${ challenge }`, data )
        
        // Save score to database
        await save_challenge_response_score( { correct, challenge, score, speed_score, uniqueness_score, country_uniqueness_score, solved_at } )
        log.info( `[POST] Challenge ${ challenge } solved with score ${ score }` )

        // Memory cache miner uid score
        let miner_scores = cache( `last_known_miner_scores` ) || {}
        const miner_ip_to_country = cache( `miner_ip_to_country` ) || {}
        const country = miner_ip_to_country[ unspoofable_ip ] || 'unknown'
        miner_scores[ miner_uid ] = { score, timestamp: Date.now(), details, country, ip: unspoofable_ip }

        // Sort the scores by timestamp (latest to oldest)
        miner_scores = Object.entries( miner_scores )
            .sort( ( a, b ) => b[1].timestamp - a[1].timestamp )
            .map( ( [ uid, miner_entry ] ) => [ uid, { ...miner_entry, timestamp: new Date( miner_entry.timestamp ).toString() } ]  )
            .reduce( ( acc, [ key, value ] ) => ( { ...acc, [ key ]: value } ), {} )
        cache( `last_known_miner_scores`, miner_scores )

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