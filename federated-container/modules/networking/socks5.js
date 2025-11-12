import { log, sanetise_ipv4 } from "mentie"
import { run } from "../system/shell.js"

/**
 * 
 * @param {Object} params
 * @param {string} params.sock - SOCKS5 proxy string (e.g., socks5://user:pass@ip:port)
 * @returns {Promise<boolean>} - True if the SOCKS5 connection is working, false otherwise.
 */
export async function test_socks5_connection( { sock } ) {

    try {

        // Build the curl commands
        const curl_icanhaz = `curl -m 2 -s ipv4.icanhazip.com`
        const curl_socks5 = `curl -m 2 -s -x ${ sock } ipv4.icanhazip.com`

        // Test ips
        let { stdout: direct_ip } = await run( curl_icanhaz )
        let { stdout: socks5_ip } = await run( curl_socks5 )

        // Sanetise
        direct_ip = sanetise_ipv4( direct_ip )
        socks5_ip = sanetise_ipv4( socks5_ip )

        // Compare
        const is_working = direct_ip !== socks5_ip
        if( !is_working ) {
            log.info( `SOCKS5 proxy test failed: direct IP (${ direct_ip }) matches SOCKS5 IP (${ socks5_ip })` )
        }
        return is_working

    } catch ( e ) {
        log.error( `Error testing SOCKS5 connection:`, e )
        return false
    }

}