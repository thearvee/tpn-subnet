import { log } from "mentie"
import { get_pg_pool, format } from "./postgres.js"
import { is_valid_worker } from "../validations.js"

/**
 * Write an array of worker objects to the WORKERS table, where their ip is the primary key, and the entry is updated if it already exists.
 * @param {Array} workers - Array of worker objects with properties: ip, country_code
 * @returns {Promise<Object>} - Result object with success status and number of entries written
 * @throws {Error} - If there is an error writing to the database
 */
export async function write_workers( { workers, mining_pool_uid, mining_pool_ip } ) {

    // Get the postgres pool
    const pool = await get_pg_pool()
    if( !pool ) throw new Error( `Postgres pool not available` )

    // Validate input
    const [ valid_workers, invalid_workers ] = workers.reduce( ( acc, worker ) => {
        if( is_valid_worker( worker ) ) acc[0].push( worker )
        else acc[1].push( worker )
        return acc
    }, [ [], [] ] )
    if( invalid_workers.length > 0 ) log.warn( `Invalid worker entries found:`, invalid_workers )
    if( valid_workers.length === 0 ) return { success: true, count: 0 }

    // Prepare the query with pg-format
    const values = valid_workers.map( ( { ip, country_code } ) => [
        ip, country_code, Date.now(), mining_pool_uid, mining_pool_ip
    ] )
    const query = format( `
        INSERT INTO workers (ip, country_code, updated_at, mining_pool_uid, mining_pool_ip)
        VALUES %L
        ON CONFLICT (ip) DO UPDATE SET
            country_code = EXCLUDED.country_code,
            updated_at = EXCLUDED.updated_at,
            mining_pool_uid = EXCLUDED.mining_pool_uid,
            mining_pool_ip = EXCLUDED.mining_pool_ip
    `, values )

    // Execute the query
    try {
        const result = await pool.query( query )
        log.info( `Wrote ${ result.rowCount } workers to database for mining pool ${ mining_pool_uid }@${ mining_pool_ip }` )
        return { success: true, count: result.rowCount }
    } catch ( e ) {
        throw new Error( `Error writing workers to database: ${ e.message }` )
    }


}