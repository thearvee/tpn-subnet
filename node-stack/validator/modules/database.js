import sqlite3 from 'sqlite3'
import { open } from 'sqlite'

// Create file system awareness
import url from 'url'
import { log } from 'mentie'
const __dirname = url.fileURLToPath( new URL( '.', import.meta.url ) )

// Create the database
let db = await open( {
    filename: `${ __dirname }/../database.sqlite`,
    driver: sqlite3.Database
} )

export async function init_tables() {

    // If the table "TIMESTAMPS" does not exist, create it
    await db.exec( `
        CREATE TABLE IF NOT EXISTS TIMESTAMPS (
            label TEXT PRIMARY KEY, 
            timestamp INTEGER,
            updated INTEGER
        )
    ` )

    // If the table "CHALLENGES" does not exist, create it
    await db.exec( `
        CREATE TABLE IF NOT EXISTS CHALLENGES (
            challenge TEXT PRIMARY KEY,
            response TEXT,
            created INTEGER,
            solved INTEGER
        )
    ` )

    // If the table "IP_ADDRESSES" does not exist, create it
    await db.exec( `
        CREATE TABLE IF NOT EXISTS IP_ADDRESSES (
            ip_address TEXT PRIMARY KEY,
            country TEXT,
            updated INTEGER
        )
    ` )

}


/**
 * Saves an IP address and its associated country to the database.
 * If the IP address already exists, it will be overwritten.
 *
 * @param {Object} params - The parameters for saving the IP address.
 * @param {string} params.ip_address - The IP address to save.
 * @param {string} params.country - The country associated with the IP address.
 * @returns {Promise<Object>} statistics
 * @returns {number} statistics.ip_count - The total number of IP addresses in the database.
 * @returns {number} statistics.country_count - The total number of IP addresses in the same country.
 * @returns {number} statistics.ip_pct_same_country - The percentage of IP addresses in the same country.
 */
export async function save_ip_address_and_return_ip_stats( { ip_address, country } ) {

    // Check how many ip addresses are in the database, include only addresse that are not stale
    const ms_to_stale = 1_000 * 60 * 30
    const stale_timestamp = Date.now() - ms_to_stale
    const { count: ip_count=0 } = await db.get( ` SELECT COUNT(*) AS count FROM IP_ADDRESSES WHERE updated > ? `, stale_timestamp )
    log.info( `Total ip addresses: ${ ip_count }` )

    // Check how many are in the same country as this ip, exclude stale ip addresses
    log.info( `Checking for ip addresses in the same country: ${ country }` )
    const { count: country_count=0 } = await db.get( ` SELECT COUNT(*) AS count FROM IP_ADDRESSES WHERE country = ? AND updated > ? `, country, stale_timestamp )
    log.info( `Total ip addresses in the same country: ${ country_count }` )

    // Calculate the percentage of ip addresses in the same country
    const ip_pct_same_country = ip_count === 0 ? 0 : Math.round( country_count / ip_count * 100 )
    log.info( `Percentage of ip addresses in the same country: ${ ip_pct_same_country }` )

    // Save this ip address and country to the database, overwrite any existing ip address with the same value
    await db.run( `INSERT INTO IP_ADDRESSES (ip_address, country, updated) VALUES (?, ?, ?) ON CONFLICT(ip_address) DO UPDATE SET country = ?, updated = ?`, ip_address, country, Date.now(), country, Date.now() )

    // Return the counts
    return { ip_count, country_count, ip_pct_same_country }

}


/**
 * Retrieves the timestamp associated with a given label from the database.
 *
 * @param {Object} params - The parameters object.
 * @param {string} params.label - The label to search for in the database.
 * @returns {Promise<number>} The timestamp associated with the label, or 0 if not found.
 */
export async function get_timestamp( { label } ) {
    const { timestamp=0 } = await db.get( ` SELECT * FROM TIMESTAMPS WHERE label = ? LIMIT 1 `, label ) || {}
    return timestamp
}

/**
 * Sets a timestamp in the database for a given label.
 *
 * @param {Object} params - The parameters for setting the timestamp.
 * @param {string} params.label - The label associated with the timestamp.
 * @param {number} params.timestamp - The timestamp value to be set.
 * @returns {Promise<void>} A promise that resolves when the timestamp is set.
 */
export async function set_timestamp( { label, timestamp } ) {
    await db.run( `INSERT INTO TIMESTAMPS (label, timestamp, updated) VALUES (?, ?, ?) ON CONFLICT(label) DO UPDATE SET timestamp = ?, updated = ?`, label, timestamp, Date.now(), timestamp, Date.now() )
    log.info( `Timestamp set:`, { label, timestamp } )
}

/**
 * Saves a challenge and its response to the database.
 * 
 * @async
 * @function save_challenge_response
 * @param {Object} pair - The input object.
 * @param {string} pair.challenge - The challenge string.
 * @param {string} pair.response - The response string.
 * @returns {Promise<Object>} The saved challenge and response.
 * @throws Will throw an error if the challenge UUID already exists in the database.
 */
export async function save_challenge_response( { challenge, response } ) {

    // Save the challenge, but error if the uuid already exists
    await db.run( `INSERT INTO CHALLENGES (challenge, response, created) VALUES (?, ?, ?)`, challenge, response, Date.now() )

    return { challenge, response }

}

/**
 * Retrieves the response and creation date for a given challenge from the database.
 *
 * @param {Object} params - The parameters for the function.
 * @param {string} params.challenge - The challenge string to look up in the database.
 * @returns {Promise<Object>} A promise that resolves to an object containing the response and creation date.
 * @returns {string} returns.response - The response associated with the challenge.
 * @returns {string} returns.created - The creation date of the challenge.
 */
export async function get_challenge_response( { challenge } ) {
    const { response, created } = await db.get( ` SELECT * FROM CHALLENGES WHERE challenge = ? LIMIT 1 `, challenge )
    return { response, created }
}

/**
 * Solves a challenge by updating the solved field in the database with the current timestamp.
 *
 * @param {Object} params - The parameters object.
 * @param {string} params.challenge - The challenge identifier.
 * @returns {Promise<number>} The current timestamp when the challenge was solved.
 */
export async function mark_challenge_solved( { challenge } ) {

    const now = Date.now()

    // Update the solved field to now if the field is unset
    await db.run( `UPDATE CHALLENGES SET solved = ? WHERE challenge = ? AND solved IS NULL`, now, challenge )

    // Read the solved field
    const { solved } = await db.get( `SELECT solved FROM CHALLENGES WHERE challenge = ? LIMIT 1`, challenge )
    return solved

}