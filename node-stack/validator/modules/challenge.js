import { v4 as uuidv4 } from 'uuid'
import { get_challenge_response, mark_challenge_solved, save_challenge_response } from './database.js'
import { log } from 'mentie'


/**
 * Generates a new challenge and response, saves them to the database, and returns the challenge.
 *
 * @async
 * @function generate_challenge
 * @returns {Promise<String>} The generated challenge.
 */
export async function generate_challenge() {

    // Generate new challenge id
    const challenge = uuidv4()

    // Generate new response value
    const response = uuidv4()

    // Save the challenge and response to the database
    await save_challenge_response( { challenge, response } )

    return challenge

}

export async function solve_challenge( { challenge, response } ) {

    const solution = await get_challenge_response( { challenge } )

    // If the response is wrong, return false
    if( solution.response != response ) {
        log.info( `Challenge ${ challenge } submitted faulty response: ${ response }` )
        return { correct: false }
    }

    // If the response is correct, return the time it took to solve
    log.info( `Challenge ${ challenge } submitted correct response: ${ response }` )
    const solved_at = await mark_challenge_solved( { challenge } )
    const ms_to_solve = solved_at - solution.created
    return { correct: true, ms_to_solve, solved_at }

}