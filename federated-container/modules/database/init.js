import { get_pg_pool } from "./postgres.js"
import { log } from "mentie"
const { CI_MODE } = process.env

export async function init_database() {
    const pool = await get_pg_pool()

    // In dev, delete old table
    if( CI_MODE ) {
        log.info( 'Dropping old tables in CI mode' )
        await pool.query( `DROP TABLE IF EXISTS workers` )
    }
}
