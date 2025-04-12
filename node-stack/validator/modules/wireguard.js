import { cache, log, random_number_between, random_string_of_length, wait } from "mentie"
import { generate_challenge, solve_challenge } from "./challenge.js"
import { run } from "./shell.js"
import { base_url } from "./url.js"

// Timeout used for curl commands
const test_timeout_seconds = 60

// Split multi-line commands into an array of commands
const split_ml_commands = commands => commands.split( '\n' ).map( c => c.replace( /#.*$/gm, '' ) ).filter( c => c.trim() ).map( c => c.trim() )

/**
 * Waits for a given IP address to become free (not in use) within a specified timeout period.
 * @param {Object} options - The options for the function.
 * @param {string} options.ip_address - The IP address to check.
 * @param {number} [options.timeout=test_timeout_ms] - The maximum time to wait for the IP address to become free, in milliseconds.
 * @throws {Error} Throws an error if no IP address is provided.
 * @returns {Promise<boolean>} Resolves to `true` if the IP address becomes free within the timeout, or `false` if it remains in use.
 */
export async function wait_for_ip_free( { ip_address, timeout_s=test_timeout_seconds, log_tag=Date.now() } ) {

    log.info( log_tag, `Waiting for IP address ${ ip_address } to become free` )

    // Check if the ip address is valid
    if( !ip_address ) throw new Error( `No ip address provided` )

    // Check the cache for the ip address being in process
    let ip_being_processed = cache( `ip_being_processed_${ ip_address }` )

    // Check if the ip address is already in use
    const { stdout, stderr } = await run( `ip addr show | grep ${ ip_address } || true`, { silent: false, verbose: true, log_tag } )
    let ip_taken = stdout?.includes( ip_address )

    // If ip not taken, return out
    if( !ip_taken ) {
        log.info( log_tag, `IP address ${ ip_address } is free, no need to wait` )
        return true
    }

    // If ip is taken, wait for it to be free
    let waited_for = 0
    const timeout = timeout_s * 1000
    const interval = 5000
    while( ip_taken && waited_for < timeout ) {
        log.info( log_tag, `IP address ${ ip_address } is in use, waiting ${ interval / 1000 }s (waited for ${ waited_for / 1000 }s) for it to become free...` )
        await wait( interval )
        waited_for += interval

        // Check on interface level
        const { stdout, stderr } = await run( `ip addr show | grep ${ ip_address } || true`, { silent: false } )

        // Check on cache level
        ip_being_processed = cache( `ip_being_processed_${ ip_address }` )

        ip_taken = stdout?.includes( ip_address ) || ip_being_processed
        if( !ip_taken ) break
    }

    // If ip is still taken, return false
    if( ip_taken ) {
        log.warn( log_tag, `IP address ${ ip_address } is still in use after ${ waited_for / 1000 } seconds` )
        return false
    }
    log.info( log_tag, `IP address ${ ip_address } is free after ${ waited_for / 1000 } seconds` )
    return true

}

/**
 * Cleans up TPN interfaces by deleting their links, routing tables, 
 * and configuration files. Can operate in dry-run mode to simulate the cleanup process.
 *
 * @param {Object} [options={}] - The options for the cleanup process.
 * @param {string[]} [options.interfaces] - The list of interface names to clean up. If not provided, all TPN interfaces will be targeted.
 * @param {string[]} [options.ip_addresses] - The list of IP addresses to find associated interfaces for cleanup.
 * @param {boolean} [options.dryrun=false] - If true, the cleanup process will only log actions without making changes.
 * @returns {Promise<boolean>} - Returns `true` if any interfaces were cleaned up, otherwise `false`.
 */
export async function clean_up_tpn_interfaces( { interfaces, ip_addresses, dryrun=false }={} ) {

    log.info( `Cleaning up ${ interfaces?.length || 'all' } interfaces` )

    // Get all interfaces
    if( !interfaces && !ip_addresses ) {
        log.info( `No interfaces provided, getting all interfaces` )
        const { stdout } = await run( `ip link show`, { silent: false } )
        interfaces = stdout.split( '\n' ).filter( line => line.includes( 'tpn' ) ).map( line => line.split( ':' )[ 1 ].trim() )   
        log.info( `Found TPN interfaces:`, interfaces )
    }

    // Get all interfaces associated with the ip addresses
    if( ip_addresses ) {
        log.info( `Getting all interfaces associated with ip addresses:`, ip_addresses )
        const interfaces_of_ips = await Promise.all( ip_addresses.map( ip => {
            const { stdout } = run( `ip addr show | grep ${ ip } | awk -F' ' '{print $2}'` )
            if( stdout?.includes( 'tpn' ) ) return stdout.trim()
            return null
        } ) ).split( '\n' ).filter( line => line?.includes( 'tpn' ) ).trim()
        log.info( `Found interfaces associated with ip addresses:`, interfaces_of_ips )
        interfaces = interfaces ? [ ...interfaces, ...interfaces_of_ips ] : interfaces_of_ips
    }

    // If no interfaces found, return
    if( !interfaces || !interfaces?.length ) {
        log.info( `No interfaces found to clean up` )
        return false
    }

    // Loop over interfaces and delete them, their routing tables, and their config file
    log.info( `Deleting ${ interfaces?.length } interfaces` )
    for( const interface_id of interfaces ) {
        if( dryrun ) {
            log.info( `Dryrun enabled, not deleting interface ${ interface_id }` )
            continue
        }
        log.info( `Cleaning up interface ${ interface_id } link, route, config` )
        await run( `ip link delete ${ interface_id }`, { silent: false } )
        await run( `ip route flush table ${ interface_id }`, { silent: false } )
        await run( `rm -f /tmp/${ interface_id }.conf`,  { silent: false } )
        log.info( `Deleted interface ${ interface_id } and all associated entries` )
    }

    return !!interfaces?.length

}

/**
 * Validate a wireguard config by running it and checking the response of a challenge hosted on this machine
 * @param {Object} params
 * @param {string} params.peer_config - The wireguard config to validate
 * @param {string} params.peer_id - The peer id to use for logging
 * @returns {Object} - The result of the validation
 * @returns {boolean} result.valid - Whether the wireguard config is valid
 * @returns {string} result.message - The message to return
 */
export async function validate_wireguard_config( { peer_config, peer_id } ) {

    const log_tag = `[ ${ peer_id }_${ Date.now() } ]`

    // Validate the wireguard config
    if( !peer_config ) return { valid: false, message: `No wireguard config provided` }
    const expected_props = [ '[Interface]', '[Peer]', 'Address', 'PrivateKey', 'ListenPort', 'PublicKey', 'PresharedKey', 'AllowedIPs', 'Endpoint' ]
    const missing_props = expected_props.filter( prop => !peer_config.includes( prop ) )
    if( missing_props.length ) {
        log.warn( `${ log_tag } Wireguard config for peer ${ peer_id } is missing required properties:`, missing_props )
        return { valid: false, message: `Wireguard config for peer ${ peer_id } is missing required properties: ${ missing_props.join( ', ' ) }` }
    }
    
    // Generate a challenge on this machine
    // const { CI_MODE, CI_IP, PUBLIC_VALIDATOR_URL } = process.env
    // let [ ci_ip ] = CI_IP.split( '\n' ).filter( ip => ip.trim() ) || []
    // const base_url = CI_MODE ? `http://${ ci_ip }:3000` : PUBLIC_VALIDATOR_URL
    const challenge = await generate_challenge()
    const challenge_url = `${ base_url }/challenge/${ challenge }`

    // The peer_config in CI mode uses SERVERURL=miner, we should resolve that within this container because namespaces cannot use the docker DNS resolver
    // if( CI_MODE ) {
    //     log.info( `Replacing miner with ${ ci_ip } in peer_config` )
    //     peer_config = peer_config.replace( 'miner', ci_ip )
    //     log.info( `Peer config after replacement:` )
    // }

    // Run specific variables
    const interface_id = `tpn${ peer_id }${ random_string_of_length( 9 ) }`
    const routing_table = random_number_between( 255, 2**32 - 1 ) // Up to 255 is used by the system
    const config_path = `/tmp/${ interface_id }.conf`
    let { stdout: default_route } = await run( `ip route show default | awk '/^default/ {print $3}'`, { silent: false, log_tag } )
    default_route = default_route.trim()
    log.info( `${ log_tag } Default route:`, default_route )

    // Get the endpoint host from the config
    let { 1: endpoint } = peer_config.match( /Endpoint ?= ?(.*)/ ) || []
    endpoint = `${ endpoint }`.trim().split( ':' )[ 0 ]
    log.info( `${ log_tag } Parsed endpoint from wireguard config for peer ${ peer_id }:`, endpoint )

    // Get the address from the config
    let { 1: address } = peer_config.match( /Address ?= ?(.*)/ ) || []
    address = `${ address }`.split( '/' )[ 0 ]
    log.info( `${ log_tag } Parsed address from wireguard config for peer ${ peer_id }:`, address )

    // Get other relevant wireguard info from config
    const privatekey = peer_config.match( /PrivateKey ?= ?(.*)/ )?.[ 1 ]?.trim()
    const listenport = peer_config.match( /ListenPort ?= ?(.*)/ )?.[ 1 ]?.trim()
    const dns = peer_config.match( /DNS ?= ?(.*)/ )?.[ 1 ]?.trim()
    const peer_publickey = peer_config.match( /PublicKey ?= ?(.*)/ )?.[ 1 ]?.trim()
    const peer_presharedkey = peer_config.match( /PresharedKey ?= ?(.*)/ )?.[ 1 ]?.trim()
    const peer_allowedips = peer_config.match( /AllowedIPs ?= ?(.*)/ )?.[ 1 ]?.trim()

    // Validate the wireguard config variables for correct format
    let format_errors = []
    if( !privatekey.match( /^[A-Za-z0-9+/=]+$/ ) ) format_errors.push( `PrivateKey is not a valid base64 string` )
    if( !listenport.match( /^\d+$/ ) ) format_errors.push( `ListenPort is not a number` )
    if( !dns.match( /\d*\.\d*\.\d*\.\d*/ ) ) format_errors.push( `DNS is not a valid IP address` )
    if( !peer_publickey.match( /^[A-Za-z0-9+/=]+$/ ) ) format_errors.push( `PublicKey is not a valid base64 string` )
    if( !peer_presharedkey.match( /^[A-Za-z0-9+/=]+$/ ) ) format_errors.push( `PresharedKey is not a valid base64 string` )
    if( !peer_allowedips.match( /\d*\.\d*\.\d*\.\d*/ ) ) format_errors.push( `AllowedIPs is not a valid IP address` )
    if( format_errors.length ) {
        log.warn( `${ log_tag } Wireguard config for peer ${ peer_id } has format errors:`, format_errors )
        return { valid: false, message: `Wireguard config for peer ${ peer_id } has format errors: ${ format_errors.join( ', ' ) }` }
    }

    log.info( `${ log_tag } Validating wireguard config for peer ${ peer_id }:`, {
        address,
        endpoint,
        privatekey,
        listenport,
        dns,
        peer_publickey,
        peer_presharedkey,
        peer_allowedips,
        interface_id,
        routing_table
    } )

    // If endpoint or address are missing, error
    if( !endpoint ) {
        log.warn( `${ log_tag } Wireguard config for peer ${ peer_id } is missing endpoint` )
        return { valid: false, message: `Wireguard config for peer ${ peer_id } is missing endpoint` }
    }
    if( !address ) {
        log.warn( `${ log_tag } Wireguard config for peer ${ peer_id } is missing address` )
        return { valid: false, message: `Wireguard config for peer ${ peer_id } is missing address` }
    }

    // If endpoint is string, resolve it
    if( !endpoint.match( /\d*\.\d*\.\d*\.\d*/ ) ) {
        const { stdout, stderr } = await run( `dig +short ${ endpoint }`, { silent: false, log_tag } )
        if( stderr ) {
            log.warn( `${ log_tag } Error resolving endpoint ${ endpoint }:`, stderr )
            return { valid: false, message: `Error resolving endpoint ${ endpoint }: ${ stderr }` }
        }
        log.info( `${ log_tag } Resolved endpoint ${ endpoint } to ${ stdout }` )
        endpoint = `${ stdout }`.trim()
    }

    // If address is not an ip address, error
    if( !address.match( /\d*\.\d*\.\d*\.\d*/ ) ) {
        log.warn( `${ log_tag } Wireguard config for peer ${ peer_id } is missing address` )
        return { valid: false, message: `Wireguard config for peer ${ peer_id } is missing address` }
    }

    // If the address is not in CIDR notation, add /32
    if( !address.includes( '/' ) ) {
        log.info( `${ log_tag } Wireguard config for peer ${ peer_id } address ${ address } is not in CIDR notation, adding /32` )
        address = `${ address }/32`
        peer_config = peer_config.replace( /Address =.*/, `Address = ${ address }` )
    }

    // Add a Table = off line if it doesn't exist, add it after the Address line
    if( !peer_config.includes( 'Table = off' ) ) peer_config = peer_config.replace( /Address =.*/, `$&\nTable = off` )

    // Add a keepalive line if it does not exist, add it after the address line
    if( !peer_config.includes( 'PersistentKeepalive = 25' ) ) peer_config = peer_config.replace( /Address =.*/, `$&\nPersistentKeepalive = 25` )
    
    // Add PostUp and PostDown scripts
    // const PostUp = `
    //     PostUp = echo upsuccess 
    // `.trim()
    // const PostDown = `
    //     PostDown = echo downsuccess
    // `.trim()
    // if( !peer_config.includes( PostUp ) ) peer_config = peer_config.replace( /Address =.*/, `$&\n${ PostUp }` )
    // if( !peer_config.includes( PostDown ) ) peer_config = peer_config.replace( /Address =.*/, `$&\n${ PostDown }` )
    // log.info( `${ log_tag } Parsed wireguard config for peer ${ peer_id }:`, peer_config )

    // Generate a peer config that only has the properties that wg accepts, 
    const { stdout: wg_peer_config } = await run( `wg-quick strip ${ config_path }`, { verbose: true, log_tag } )
    const wg_config_path = `/tmp/wg_${ peer_id }.conf`
    log.info( `${ log_tag } Parsed wireguard config for peer ${ peer_id }:`, {
        peer_config,
        wg_peer_config
    } )

    // Formulate shell commands used for testing and cleanup
    const write_config_command = `
        # Write the wireguard config to a temporary files
        printf "%s" "${ peer_config }" > ${ config_path } && \
        printf "%s" "${ wg_peer_config }" > ${ wg_config_path } && \
        # Chmod the files
        chmod 600 ${ config_path }
        chmod 600 ${ wg_config_path }
    `
    const network_setup_command = `

        # === Pre connection debug trail ===
        ping -c1 -W1 ${ endpoint }  > /dev/null 2>&1 && echo "Endpoint ${ endpoint } is reachable" || echo "Endpoint ${ endpoint } is not reachable"
        curl -m 5 -s icanhazip.com
        ip route show
        ip a
        ip neigh
        ip rule
        ip link

        # === CREATE WG INTERFACE ===
        ip link add ${ interface_id } type wireguard
        wg setconf ${ interface_id } ${ wg_config_path }
        wg showconf ${ interface_id }

        ip address add ${ address } dev ${ interface_id }
        ip link set mtu 1280 up dev ${ interface_id }
        ip link set up dev "${ interface_id }"


        # === POLICY ROUTING ===
        ip route add ${ endpoint } via ${ default_route } dev eth0
        ip rule add from ${ address.replace( '/32', '' ) } lookup ${ routing_table }
        ip route add default dev ${ interface_id } table ${ routing_table }

        echo "Interface ${ interface_id } created with address ${ address } and routing table ${ routing_table }"


        # === Post connection debug trail ===
        wg show ${ interface_id }
        ping -I ${ interface_id } -c1 -W1 1.1.1.1  > /dev/null 2>&1 && echo "Cloudflare is reachable" || echo "Cloudflare is not reachable"
        ping -I ${ interface_id } -c1 -W1 ${ endpoint }  > /dev/null 2>&1 && echo "Endpoint ${ endpoint } is reachable" || echo "Endpoint ${ endpoint } is not reachable"
        curl -m 5 -s --interface ${ interface_id } icanhazip.com
        ip route get ${ endpoint }
        ip route get ${ endpoint } from ${ address.replace( '/32', '' ) }
        ip route show
        ip a
        ip neigh
        ip rule
        ip link

        
    `
    const curl_command = `curl -m ${ test_timeout_seconds } --interface ${ interface_id } -s ${ challenge_url }`
    const cleanup_command = `
        
        # === CLEANUP PREVIOUS STATE ===
        ip rule del from "${ address.replace( '/32', '' ) }" lookup "${ routing_table }" || echo "No need to delete rule"
        ip route flush table "${ routing_table }" || echo "No need to flush table"
        ip link del "${ interface_id }" || echo "No need to force delete interface"

        rm -f ${ config_path }
        rm -f ${ wg_config_path }
        ip addr flush dev ${ interface_id } || echo "No need to flush address"

    `


    // Formulate required functions
    const run_cleanup = async ( { silent=false }={} ) => {

        // loop over cleanup commands
        const cleanup_commands = split_ml_commands( cleanup_command )
        for( const command of cleanup_commands ) {
            await run( command, { silent, log_tag } )
        }

    }
    const run_test = async () => {

        // TEMPORARY CHECK, log out all intefaces
        await run( `ip addr show`, { silent: false, verbose: true, log_tag } )

        // Check for ip address conflicts
        const timeout = test_timeout_seconds * 5 // How many ip addresses to assume in the worst of circumstances to take their max timeout
        const ip_free = await wait_for_ip_free( { ip_address: address, timeout, log_tag } )
        if( !ip_free ) {
            const ip_cleared = await clean_up_tpn_interfaces( { ip_addresses: [ address ] } )
            if( !ip_cleared ) throw new Error( `IP address ${ address } is still in use after cleanup` )
            log.info( `${ log_tag } IP address ${ address } is free after cleanup` )
        }

        // Mark the ip address as in processing
        cache( `ip_being_processed_${ address }`, true, timeout * 1000 )
        log.info( `${ log_tag } Marking ip address ${ address } as in processing` )

        // Write the wireguard config to a file
        const config_cmd = await run( write_config_command, { silent: true, log_tag } )
        if( config_cmd.error || config_cmd.stderr ) throw new Error( `Error writing wireguard config: ${ config_cmd.error } ${ config_cmd.stderr }` )

        // loop over network commands
        const network_setup_commands = split_ml_commands( network_setup_command )

        for( const command of network_setup_commands ) {
            await run( command, { silent: false, verbose: true, log_tag } )
        }
    

        // Run the curl command
        const { error, stderr, stdout } = await run( curl_command, { silent: false, verbose: true, log_tag } )
        if( error || stderr ) throw new Error( `${ log_tag } Error running curl test for ${ peer_id }` )
        
        // Isolate the json
        const [ json ] = stdout.match( /{.*}/s ) || []
        if( !json ) {
            log.warn( `${ log_tag } No JSON response found in stdout:`, stdout )
            return false
        }

        // Return the json response
        log.info( `${ log_tag } Wireguard config for peer ${ peer_id } responded with:`, json )
        return json

    } 

    // Open the challenge url using the wireguard config
    try {

        // Do pre-emptive cleanup in case a previous run messed up
        log.info( `\n ${ log_tag } 🧹 Running pre-cleanup commands for peer ${ peer_id }` )
        await run_cleanup( { silent: true, log_tag } )

        // Solve the challenge from the miner ip
        log.info( `\n ${ log_tag } 🔎 Running test commands for peer ${ peer_id }` )
        const stdout = await run_test()

        // Mark ip address as no longer in processing
        cache( `ip_being_processed_${ address }`, false )
        log.info( `${ log_tag } Marking ip address ${ address } as no longer in processing` )

        // Extract the challenge and response from the stdout
        let [ json_response ] = stdout.match( /{.*}/s ) || []
        if( !json_response ) {
            log.warn( `${ log_tag } No JSON response found in stdout:`, stdout )
            return { valid: false, message: `No JSON response found in stdout` }
        }
        const { response } = JSON.parse( json_response )

        // Verify that the response is valid
        log.info( `${ log_tag } Checkin challenge/response solution ${ challenge }/${ response }` )
        const { correct } = await solve_challenge( { challenge, response } )
        
        // Check that the response is valid
        if( !correct ) {
            log.info( `${ log_tag } Wireguard config failed challenge for peer ${ peer_id }` )
            return { valid: false, message: `Wireguard config failed challenge for peer ${ peer_id }` }
        }

        // Run cleanup command
        log.info( `\n ${ log_tag } 🧹  Running cleanup commands for peer ${ peer_id }` )
        await run_cleanup( { silent: false, log_tag } )

        // If the response is valid, return true
        log.info( `${ log_tag } Wireguard config passed for peer ${ peer_id } ${ challenge } with response ${ response }` )
        return { valid: true, message: `Wireguard config passed for peer ${ peer_id } ${ challenge } with response ${ response }` }

    } catch ( e ) {

        log.error( `${ log_tag } Error validating wireguard config for peer ${ peer_id }:`, e )
        await run_cleanup( { silent: true, log_tag } )
        return { valid: false, message: `Error validating wireguard config for peer ${ peer_id }: ${ e.message }` }

    }

}