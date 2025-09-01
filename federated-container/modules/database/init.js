import { run_mode } from "../validations.js"
import { get_pg_pool } from "./postgres.js"
import { log } from "mentie"
const { CI_MODE } = process.env

export async function init_database() {

    const pool = await get_pg_pool()
    const { validator_mode, miner_mode, worker_mode } = run_mode()

    // In dev, delete old table
    if( CI_MODE ) {
        log.info( 'Dropping old tables in CI mode' )
        await pool.query( `DROP TABLE IF EXISTS workers` )
        await pool.query( `DROP TABLE IF EXISTS timestamps` )
        await pool.query( `DROP TABLE IF EXISTS worker_broadcast_metadata` )
        await pool.query( `DROP TABLE IF EXISTS mining_pool_metadata_broadcast` )
        await pool.query( `DROP TABLE IF EXISTS challenge_solution` )
        await pool.query( `DROP TABLE IF EXISTS scores` )
        await pool.query( `DROP TABLE IF EXISTS worker_wireguard_configs` )
    }

    // Create the WORKERS table if it doesn't exist
    if( miner_mode || validator_mode ) {
        await pool.query( `
            CREATE TABLE IF NOT EXISTS workers (
                PRIMARY KEY (mining_pool_uid, mining_pool_ip, ip),
                ip TEXT,
                country_code TEXT NOT NULL,
                updated_at BIGINT NOT NULL,
                mining_pool_uid TEXT NOT NULL,
                mining_pool_ip TEXT NOT NULL,
                status TEXT NOT NULL
            )
        ` )
        log.info( `✅ Workers table initialized` )
    }

    // Create WORKER_BROADCAST_METADATA table if it does not exist yet
    if( miner_mode || validator_mode ) {
        await pool.query( `
            CREATE TABLE IF NOT EXISTS worker_broadcast_metadata (
                mining_pool_uid TEXT NOT NULL,
                mining_pool_ip TEXT NOT NULL,
                last_known_worker_pool_size BIGINT NOT NULL,
                updated BIGINT NOT NULL,
                PRIMARY KEY (mining_pool_uid, mining_pool_ip)
            )
        ` )
        log.info( `✅ Worker broadcast metadata table initialized` )
    }

    // Create MINING_POOL_METADATA_BROADCAST table if it does not exist yet
    if( validator_mode ) {
        await pool.query( `
            CREATE TABLE IF NOT EXISTS mining_pool_metadata_broadcast (
                mining_pool_uid TEXT NOT NULL,
                mining_pool_ip TEXT NOT NULL,
                protocol TEXT NOT NULL,
                url TEXT NOT NULL,
                port INTEGER NOT NULL,
                PRIMARY KEY (mining_pool_uid, mining_pool_ip)
            )
        ` )
        log.info( `✅ Mining pool metadata broadcast table initialized` )
    }

    // Create challenge/solution table if it does not exist yet
    if( miner_mode || validator_mode ) {
        await pool.query( `
            CREATE TABLE IF NOT EXISTS challenge_solution (
                challenge TEXT NOT NULL,
                solution TEXT NOT NULL,
                PRIMARY KEY (challenge)
            )
        ` )
        log.info( `✅ Challenge solution table initialized` )
    }

    // Create SCORES table if it doesn't exist yet
    if( validator_mode ) {
        await pool.query( `
            CREATE TABLE IF NOT EXISTS scores (
                PRIMARY KEY (mining_pool_uid, mining_pool_ip),
                mining_pool_ip TEXT NOT NULL,
                mining_pool_uid TEXT NOT NULL,
                stability_score INTEGER NOT NULL,
                size_score INTEGER NOT NULL,
                performance_score INTEGER NOT NULL,
                geo_score INTEGER NOT NULL,
                score INTEGER NOT NULL
            )
        ` )
        log.info( `✅ Scores table initialized` )
    }

    // Create the WORKER_WIREGUARD_CONFIGS table if it doesn't exist
    if( worker_mode ) {
        await pool.query( `
            CREATE TABLE IF NOT EXISTS worker_wireguard_configs (
                id SERIAL PRIMARY KEY,
                expires_at BIGINT NOT NULL,
                updated_at TIMESTAMP NOT NULL
            )
        ` )
        log.info( `✅ Worker WireGuard configs table initialized` )

    }

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
