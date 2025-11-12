import { log, sanetise_ipv4 } from "mentie"

export async function test_socks5_connection( { sock } ) {

    try {

        // Build the curl commands
        const curl_icanhaz = `curl ipv4.icanhazip.com`
        const curl_socks5 = `curl -x ${ sock } ipv4.icanhazip.com`

        // Test ips
        let { stdout: direct_ip } = await run( curl_icanhaz, { timeout: 10000 } )
        let { stdout: socks5_ip } = await run( curl_socks5, { timeout: 10000 } )

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