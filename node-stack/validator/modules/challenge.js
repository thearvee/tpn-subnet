import { v4 as uuidv4 } from 'uuid'
import { save_challenge_response } from './database.js'


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