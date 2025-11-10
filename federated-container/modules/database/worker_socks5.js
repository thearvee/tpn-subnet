import { cache, log, wait } from "mentie"
import { format, get_pg_pool } from "./postgres.js"


export async function write_socks( { socks } ) {

    try {

        // Get pool
        const pool = await get_pg_pool()

        // Validate socks
        const expected_properties = [ 'ip_address', 'port', 'username', 'password', 'available' ]
        let valid_socks = socks.filter( sock => {
            const sock_props = Object.keys( sock )
            return expected_properties.every( prop => sock_props.includes( prop ) )
        } )

        // Annotate with timestamp
        const now = Date.now()
        valid_socks = valid_socks.map( sock => ( { ...sock, updated: now } ) )

        // Prepare a query that deletes existing entries for the given IPs
        const ips = valid_socks.map( sock => sock.ip_address )
        const delete_query = format( `
            DELETE FROM worker_socks5_configs
            WHERE ip_address IN ( %L )
        `, ips )

        // Prepare the addition query
        const insert_query = format( `
            INSERT INTO worker_socks5_configs ( ip_address, port, username, password, available, updated )
            VALUES %L
        `, valid_socks.map( sock => [ sock.ip_address, sock.port, sock.username, sock.password, sock.available, sock.updated ] ) )

        // Execute the delete
        await pool.query( delete_query )

        // Execute the insert
        await pool.query( insert_query )

        return { success: true }

    } catch ( e ) {
        console.error( `Error in write_available_socks:`, e )
        return { success: false, error: e.message }
    }

}

export async function count_available_socks() {

    try {

        // Get pool
        const pool = await get_pg_pool()

        // Query count of available socks
        const query = `
            SELECT COUNT(*) AS available_count
            FROM worker_socks5_configs
            WHERE available = TRUE
        `
        const result = await pool.query( query )
        const available_socks_count = Number( result.rows[0]?.available_count || 0 )

        return { success: true, available_socks_count }

    } catch ( e ) {
        console.error( `Error in count_available_socks:`, e )
        return { success: false, error: e.message }
    }

}

export async function register_socks5_lease( { expires_at } ) {

    try {

        // Get pool
        const pool = await get_pg_pool()

        // Mitigate race conditions
        const working_key = `register_socks5_lease_working`
        let working = cache( working_key )
        while( working ) {
            log.debug( `register_socks5_lease is already in progress, waiting...` )
            await wait( 1000 )
            working = cache( working_key )
            log.debug( `Working: ${ working }` )
        }
        log.debug( `Starting register_socks5_lease` )
        cache( working_key, true )

        // Find an available socks5 config
        const select_query = `
            SELECT *
            FROM worker_socks5_configs
            WHERE available = TRUE
            LIMIT 1
            FOR UPDATE SKIP LOCKED
        `
        const result = await pool.query( select_query )
        const [ sock ] = result.rows || []

        // Mark the config as unavailable
        if( sock ) {
            const update_query = `
                UPDATE worker_socks5_configs
                SET available = FALSE, expires_at = $1, updated = $2
                WHERE ip_address = $3
            `
            await pool.query( update_query, [ expires_at, Date.now(), sock.ip_address ] )
            log.info( `Registered SOCKS5 lease for ${ sock.ip_address }:${ sock.port }, expires at ${ new Date( expires_at ).toISOString() }` )
        }

        // Mark the password as unavailable through touching /passwords/<username>.password.used
        const { PASSWORD_DIR='/passwords' } = process.env
        if( sock ) await run( `touch ${ PASSWORD_DIR }/${ sock.username }.password.used` )
        
        // Release working lock
        cache( working_key, false )

        return { success: true, sock }


    } catch ( e ) {
        log.error( `Error in register_socks5_lease:`, e )
        return { success: false, error: e.message }
    }

}
