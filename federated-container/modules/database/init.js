import { get_pg_pool } from "./postgres.js"
import { log } from "mentie"
const { CI_MODE } = process.env

export async function init_database() {
    const pool = await get_pg_pool()

    // In dev, delete old table
    if( CI_MODE ) {
        log.info( 'Dropping old tables in CI mode' )
        await pool.query( `DROP TABLE IF EXISTS workers` )
        await pool.query( `DROP TABLE IF EXISTS timestamps` )
    }

    // Create the WORKERS table if it doesn't exist
    await pool.query( `
        CREATE TABLE IF NOT EXISTS workers (
            ip TEXT PRIMARY KEY,
            country_code TEXT NOT NULL,
            updated_at BIGINT NOT NULL,
            mining_pool_uid TEXT NOT NULL,
            mining_pool_ip TEXT NOT NULL
            )
    ` )
    log.info( `✅ Workers table initialized` )

    // Create the TIMESTAMPS table if it doesn't exist
    await pool.query( `
        CREATE TABLE IF NOT EXISTS timestamps (
            label TEXT PRIMARY KEY,
            timestamp BIGINT NOT NULL,
            updated BIGINT NOT NULL,
            UNIQUE (label)
        )
    ` )
    log.info( `✅ Timestamps table initialized` )

}
