import { log } from "mentie"
import { get_pg_pool, format } from "./postgres.js"
import { is_valid_worker } from "../validations.js"

/**
 * Write an array of worker objects to the WORKERS table, where the composite primary key is (mining_pool_uid, mining_pool_ip, ip), and the entry is updated if it already exists.
 * @param {Array<{ ip: string, country_code: string, status?: string }>} workers - Array of worker objects with properties: ip, country_code
 * @param {string} mining_pool_uid - Unique identifier of the mining pool submitting the workers
 * @param {string} mining_pool_ip - IP address of the mining pool submitting the workers
 * @param {boolean} is_miner_broadcast - broadcasts update mining pool worker metadata based on the worker array, only set if worker array is full worker list from mining pool
 * @returns {Promise<{ success: boolean, count: number, broadcast_metadata?: Object }> } - Result object with success status and number of entries written
 * @throws {Error} - If there is an error writing to the database
 */
export async function write_workers( { workers, mining_pool_uid, mining_pool_ip, is_miner_broadcast=false } ) {
    // Get the postgres pool
    const pool = await get_pg_pool()

    // Validate input
    const [ valid_workers, invalid_workers ] = workers.reduce( ( acc, worker ) => {
        if( is_valid_worker( worker ) ) acc[0].push( worker )
        else acc[1].push( worker )
        return acc
    }, [ [], [] ] )
    if( invalid_workers.length > 0 ) log.warn( `Invalid worker entries found:`, invalid_workers )
    if( valid_workers.length === 0 ) return { success: true, count: 0 }

    // Prepare the query with pg-format
    const values = valid_workers.map( ( { ip, country_code, status='unknown' } ) => [
        ip,
        country_code,
        Date.now(),
        mining_pool_uid,
        mining_pool_ip,
        status
    ] )
    const query = format( `
        INSERT INTO workers (ip, country_code, updated_at, mining_pool_uid, mining_pool_ip, status)
        VALUES %L
        ON CONFLICT (mining_pool_uid, mining_pool_ip, ip) DO UPDATE SET
            ip = EXCLUDED.ip,
            country_code = EXCLUDED.country_code,
            updated_at = EXCLUDED.updated_at,
            mining_pool_uid = EXCLUDED.mining_pool_uid,
            mining_pool_ip = EXCLUDED.mining_pool_ip,
            status = EXCLUDED.status
    `, values )

    // Execute the query
    try {
        const worker_write_result = await pool.query( query )
        const broadcast_metadata = is_miner_broadcast ? await write_worker_broadcast_metadata( { mining_pool_uid, mining_pool_ip, workers: valid_workers } ) : null
        log.info( `Wrote ${ worker_write_result.rowCount } workers to database for mining pool ${ mining_pool_uid }@${ mining_pool_ip } with metadata: `, broadcast_metadata )
        return { success: true, count: worker_write_result.rowCount, broadcast_metadata }
    } catch ( e ) {
        throw new Error( `Error writing workers to database: ${ e.message }` )
    }
}

/**
 * Gets the number of unique country_code instances for workers where mining pool uid and ip are given
 * @param {Object<{ mining_pool_uid: string, mining_pool_ip: string }>} params
 * @returns {Promise<[string]>} Country codes for the workers of this pool
 */
export async function get_worker_countries_for_pool( { mining_pool_uid, mining_pool_ip } ) {

    // Get the postgres pool
    const pool = await get_pg_pool()

    const query = `
        SELECT DISTINCT country_code
        FROM workers
        WHERE mining_pool_uid = $1 AND mining_pool_ip = $2 AND status = 'up'
    `
    try {
        const result = await pool.query( query, [ mining_pool_uid, mining_pool_ip ] )
        return result.rows.map( row => row.country_code )
    } catch ( e ) {
        throw new Error( `Error fetching worker countries for pool ${ mining_pool_uid }@${ mining_pool_ip }: ${ e.message }` )
    }

}

/**
 * Writes or updates worker broadcast metadata for a mining pool in Postgres.
 * @param {Object} params - Input parameters.
 * @param {string} params.mining_pool_uid - Unique identifier of the mining pool.
 * @param {string} params.mining_pool_ip - IP address of the mining pool.
 * @param {Array<object>} params.workers - Array of worker descriptors; only the length is used.
 * @returns {Promise<{success: true, last_known_worker_pool_size: number, updated: number}>} Result indicating success with metadata.
 * @throws {Error} If the Postgres pool is unavailable or if the database write fails.
 */
async function write_worker_broadcast_metadata( { mining_pool_uid, mining_pool_ip, workers } ) {

    // Get the postgres pool
    const pool = await get_pg_pool()

    // Prepare the query with pg-format
    const last_known_worker_pool_size = workers.length
    const updated = Date.now()
    const metadata_query = `
        INSERT INTO worker_broadcast_metadata (mining_pool_uid, mining_pool_ip, last_known_worker_pool_size, updated)
        VALUES ($1, $2, $3, $4)
        ON CONFLICT (mining_pool_uid, mining_pool_ip) DO UPDATE SET
            last_known_worker_pool_size = EXCLUDED.last_known_worker_pool_size,
            updated = EXCLUDED.updated
    `
    const broadcast_metadata = {
        mining_pool_uid,
        mining_pool_ip,
        last_known_worker_pool_size,
        updated,
        mining_pool_uid_ip_combolabel: `${ mining_pool_uid }@${ mining_pool_ip }`
    }

    // Execute the query
    try {
        await pool.query( metadata_query, [ mining_pool_uid, mining_pool_ip, last_known_worker_pool_size, updated ] )
        log.info( `Wrote worker broadcast metadata to database for mining pool ${ mining_pool_uid }@${ mining_pool_ip } with metadata: `, broadcast_metadata )
        return { success: true, ...broadcast_metadata }
    } catch ( e ) {
        throw new Error( `Error writing worker broadcast metadata to database: ${ e.message }` )
    }

}

/**
 * @param {Object} params - Query parameters.
 * @param {string} params.mining_pool_uid? - Unique identifier of the mining pool.
 * @param {string} params.mining_pool_ip? - IP address of the mining pool.
 * @returns {Promise<[
 *   { success: true, mining_pool_uid: string, mining_pool_ip: string, last_known_worker_pool_size: number, updated: number } |
 *   ]>} Result object indicating success status and, if successful, the metadata row.
 * @throws {Error} If the Postgres pool is unavailable or a database query fails.
 */
export async function read_worker_broadcast_metadata( { mining_pool_uid, mining_pool_ip, limit }={} ) {

    // Get the postgres pool
    const pool = await get_pg_pool()

    // Formulate query
    const wheres = []
    const values = []
    if( mining_pool_uid ) {
        values.push( mining_pool_uid )
        wheres.push( `mining_pool_uid = $${ values.length }` )
    }
    if( mining_pool_ip ) {
        values.push( mining_pool_ip )
        wheres.push( `mining_pool_ip = $${ values.length }` )
    }
    if( limit ) values.push( limit )

    // Prepare the query
    const query = `
        SELECT mining_pool_uid, mining_pool_ip, last_known_worker_pool_size, updated
        FROM worker_broadcast_metadata
        ${ wheres.length > 0 ? `WHERE ${ wheres.join( ' AND ' ) }` : '' }
        ${ limit ? `LIMIT $${ values.length }` : '' }
    `

    // Execute the query
    try {
        const result = await pool.query( query, [ ...values ] )
        log.info( `Read worker broadcast metadata from database for mining pool ${ mining_pool_uid }@${ mining_pool_ip }: `, result.rows[0] )
        return result.rows
    } catch ( e ) {
        throw new Error( `Error reading worker broadcast metadata from database: ${ e.message }` )
    }

}

/**
 * Retrieves worker rows for a specific mining pool from the database.
 * @param {Object} params - Query parameters.
 * @param {string} params.ip? - IP address of the worker.
 * @param {string} params.mining_pool_uid? - Unique identifier of the mining pool.
 * @param {string} params.mining_pool_ip? - IP address of the mining pool.
 * @param {number} params.limit? - Maximum number of worker records to return.
 * @returns {Promise<{success: true, workers: any[]} | {success: false, message: string}>} Result indicating success with workers or a not-found message.
 * @throws {Error} If the Postgres pool is unavailable or if the database query fails.
 */
export async function get_workers( { ip, mining_pool_uid, mining_pool_ip, limit=1 } ) {
    // Get the postgres pool
    const pool = await get_pg_pool()

    // Formulate the query
    const wheres = []
    const values = []
    if( ip ) {
        values.push( ip )
        wheres.push( `ip = $${ values.length }` )
    }
    if( mining_pool_uid ) {
        values.push( mining_pool_uid )
        wheres.push( `mining_pool_uid = $${ values.length }` )
    }
    if( mining_pool_ip ) {
        values.push( mining_pool_ip )
        wheres.push( `mining_pool_ip = $${ values.length }` )
    }
    values.push( limit )

    // Prepare the query
    const query = `
        SELECT *
        FROM workers
        ${ wheres.length > 0 ? `WHERE ${ wheres.join( ' AND ' ) }` : '' }
        LIMIT $${ values.length }
    `

    // Execute the query
    try {
        const result = await pool.query( query, [ ...values ] )
        log.info( `Retrieved workers from database for mining pool ${ mining_pool_uid }@${ mining_pool_ip }: `, result.rows )
        return { success: !!result.rowCount, workers: result.rows }
    } catch ( e ) {
        throw new Error( `Error retrieving workers from database: ${ e.message }` )
    }
}
