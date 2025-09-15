import { log } from "mentie"
import { get_pg_pool } from "./postgres.js"

/**
 * Write mining pool metadata to db
 * @param {Object} params - Input parameters.
 * @param {string} params.mining_pool_uid - Unique identifier of the mining pool.
 * @param {string} params.mining_pool_ip - IP address of the mining pool.
 * @param {string} params.protocol - Protocol used by the mining pool (e.g. http, https)
 * @param {string} params.url - URL of the mining pool.
 * @param {number} params.port - Port number of the mining pool.
 * @returns {Promise<{ success: boolean, mining_pool_uid: string, mining_pool_ip: string, protocol: string, url: string, port: number }>} - The result of the database operation.
 * @throws {Error} If the Postgres pool is unavailable or if the database query fails.
 */
export async function write_mining_pool_metadata( { mining_pool_uid, mining_pool_ip, protocol, url, port } ) {

    // Get the postgres pool
    const pool = await get_pg_pool()

    // Create query
    const query = `
        INSERT INTO mining_pool_metadata_broadcast (mining_pool_uid, mining_pool_ip, protocol, url, port)
        VALUES ($1, $2, $3, $4, $5)
        ON CONFLICT (mining_pool_uid, mining_pool_ip) DO UPDATE
        SET protocol = $3, url = $4, port = $5
    `
    
    try {

        await pool.query( query, [ mining_pool_uid, mining_pool_ip, protocol, url, port ] )
        log.info( `Wrote mining pool metadata for ${ mining_pool_uid }@${ mining_pool_ip }` )
        return { success: true, mining_pool_uid, mining_pool_ip, protocol, url, port }


    } catch ( e ) {
        log.error( `Error writing mining pool metadata: ${ e.message }` )
        throw new Error( `Error writing mining pool metadata: ${ e.message }` )
    }
}

/**
 * Reads mining pool metadata for a given pool UID and IP address from Postgres.
 * @param {Object} params - Parameters for the metadata lookup.
 * @param {string} params.mining_pool_uid - Unique identifier of the mining pool.
 * @param {string} params.mining_pool_ip - IPv4/IPv6 address of the mining pool.
 * @returns {Promise<{ success: boolean, data?: Record<string, any>, message?: string }>} 
 * @throws {Error} If the Postgres pool is unavailable or if the database query fails.
 */
export async function read_mining_pool_metadata( { mining_pool_uid, mining_pool_ip } ) {

    // Get the postgres pool
    const pool = await get_pg_pool()

    // Create query
    const query = `
        SELECT * FROM mining_pool_metadata_broadcast
        WHERE mining_pool_uid = $1 AND mining_pool_ip = $2
    `

    try {
        const result = await pool.query( query, [ mining_pool_uid, mining_pool_ip ] )
        if( result.rows.length === 0 ) {
            log.warn( `No mining pool metadata found for ${ mining_pool_uid }@${ mining_pool_ip }` )
            return { success: false, message: `No mining pool metadata found` }
        }
        log.info( `Read mining pool metadata for ${ mining_pool_uid }@${ mining_pool_ip }` )
        return { success: true, data: result.rows[0] }
    } catch ( e ) {
        log.error( `Error reading mining pool metadata: ${ e.message }` )
        throw new Error( `Error reading mining pool metadata: ${ e.message }` )
    }
}

export async function write_pool_score( { mining_pool_ip, mining_pool_uid, stability_score, size_score, performance_score, geo_score, score } ) {

    // Get postgres pool
    const pool = await get_pg_pool()

    // Formulate insert (not update) query
    const query = `
        INSERT INTO scores (mining_pool_ip, mining_pool_uid, stability_score, size_score, performance_score, geo_score, score)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
    `

    try {
        await pool.query( query, [ mining_pool_ip, mining_pool_uid, stability_score, size_score, performance_score, geo_score, score ] )
        log.info( `Wrote pool score for ${ mining_pool_uid }@${ mining_pool_ip }` )
        return { success: true, mining_pool_ip, mining_pool_uid, stability_score, size_score, performance_score, geo_score, score }
    } catch ( e ) {
        log.error( `Error writing pool score: ${ e.message }` )
        throw new Error( `Error writing pool score: ${ e.message }` )
    }
}

export async function get_pool_scores() {

    // Get postgres pool
    const pool = await get_pg_pool()

    // Create query
    const query = `
        SELECT * FROM scores
        ORDER BY score DESC
    `

    try {
        const result = await pool.query( query )
        log.info( `Retrieved ${ result.rows.length } pool scores` )
        return { success: true, scores: result.rows }
    } catch ( e ) {
        log.error( `Error retrieving pool scores: ${ e.message }` )
        return { success: false, message: `Error retrieving pool scores: ${ e.message }` }
    }

}