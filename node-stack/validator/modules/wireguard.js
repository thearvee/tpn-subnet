import { log, random_number_between, random_string_of_length } from "mentie"
import { generate_challenge, solve_challenge } from "./challenge.js"
import { run } from "./shell.js"
import { base_url } from "./url.js"

const split_ml_commands = commands => commands.split( '\n' ).map( c => c.replace( /#.*$/gm, '' ) ).filter( c => c.trim() ).map( c => c.trim() )

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

    log.info( `Cleaning up ${ interfaces.length || 'all' } interfaces` )

    // Get all interfaces
    if( !interfaces && !ip_addresses ) {
        log.info( `No interfaces provided, getting all interfaces` )
        const { stdout } = await run( `ip link show`, false )
        interfaces = stdout.split( '\n' ).filter( line => line.includes( 'tpn' ) ).map( line => line.split( ':' )[ 1 ].trim() )   
        log.info( `Found interfaces:`, interfaces )
    }

    // Get all interfaces associated with the ip addresses
    if( ip_addresses ) {
        log.info( `Getting all interfaces associated with ip addresses:`, ip_addresses )
        const interfaces_of_ips = await Promise.all( ip_addresses.map( ip => {
            const { stdout } = run( `ip addr show | grep ${ ip } |  awk -F' ' '{print $2}'` )
            if( stdout.includes( 'tpn' ) ) return stdout.trim()
            return null
        } ) ).split( '\n' ).filter( line => line.includes( 'tpn' ) ).trim()
        log.info( `Found interfaces associated with ip addresses:`, interfaces_of_ips )
        interfaces = interfaces ? [ ...interfaces, ...interfaces_of_ips ] : interfaces_of_ips
    }

    // If no interfaces found, return
    if( !interfaces || !interfaces.length ) {
        log.info( `No interfaces found to clean up` )
        return false
    }

    // Loop over interfaces and delete them, their routing tables, and their config file
    log.info( `Deleting ${ interfaces.length } interfaces` )
    for( const interface_id of interfaces ) {
        if( dryrun ) {
            log.info( `Dryrun enabled, not deleting interface ${ interface_id }` )
            continue
        }
        log.info( `Cleaning up interface ${ interface_id } link, route, config` )
        await run( `ip link delete ${ interface_id }`, false )
        await run( `ip route flush table ${ interface_id }`, false )
        await run( `rm -f /tmp/${ interface_id }.conf`,  false )
        log.info( `Deleted interface ${ interface_id } and all associated entries` )
    }

    return !!interfaces.length

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

    // Validate the wireguard config
    if( !peer_config ) return { valid: false, message: `No wireguard config provided` }
    const expected_props = [ '[Interface]', '[Peer]', 'Address', 'PrivateKey', 'ListenPort', 'PublicKey', 'PresharedKey', 'AllowedIPs', 'Endpoint' ]
    const missing_props = expected_props.filter( prop => !peer_config.includes( prop ) )
    if( missing_props.length ) {
        log.warn( `Wireguard config for peer ${ peer_id } is missing required properties:`, missing_props )
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


    // Get the endpoint host from the config
    let { 1: endpoint } = peer_config.match( /Endpoint ?= ?(.*)/ ) || []
    endpoint = `${ endpoint }`.trim().split( ':' )[ 0 ]
    log.info( `Parsed endpoint from wireguard config for peer ${ peer_id }:`, endpoint )
    let { 1: address } = peer_config.match( /Address ?= ?(.*)/ ) || []
    address = `${ address }`.split( '/' )[ 0 ]
    log.info( `Parsed address from wireguard config for peer ${ peer_id }:`, address )

    // If endpoint is not cidr, add /32
    // if( endpoint.match( /\d*\.\d*\.\d*\.\d*/ ) && !endpoint.includes( '/' ) ) endpoint += '/32'

    // If endpoint is string, resolve it
    if( !endpoint.match( /\d*\.\d*\.\d*\.\d*/ ) ) {
        const { stdout, stderr } = await run( `dig +short ${ endpoint }`, false )
        log.info( `Resolved endpoint ${ endpoint } to ${ stdout }` )
        endpoint = `${ stdout }`.trim()
    }

    // Add a Table = off line if it doesn't exist, add it after the Address line
    if( !peer_config.includes( 'Table = off' ) ) peer_config = peer_config.replace( /Address =.*/, `$&\nTable = off` )
    
    // Add PostUp and PostDown scripts
    const PostUp = `
        PostUp = ip rule add from ${ address } lookup ${ routing_table }; \
        ip route add default dev ${ interface_id } table ${ routing_table }; \
        ip rule add from ${ address } lookup ${ routing_table }; 
    `.trim()
    const PostDown = `
        PostDown = ip route flush table ${ routing_table };
    `.trim()
    if( !peer_config.includes( PostUp ) ) peer_config = peer_config.replace( /Address =.*/, `$&\n${ PostUp }` )
    if( !peer_config.includes( PostDown ) ) peer_config = peer_config.replace( /Address =.*/, `$&\n${ PostDown }` )
    log.info( `Parsed wireguard config for peer ${ peer_id }:`, peer_config )

    // Formulate shell commands used for testing and cleanup
    const write_config_command = `
        # Write the wireguard config to a temporary file
        printf "%s" "${ peer_config }" > ${ config_path } && \
        # Chmod the file
        chmod 600 ${ config_path }
    `
    const network_setup_command = `
        ping -c1 -W1 ${ endpoint }  > /dev/null 2>&1 && echo "Endpoint ${ endpoint } is reachable" || echo "Endpoint ${ endpoint } is not reachable"
        curl -m 5 -s icanhazip.com
        ip route show
        WG_DEBUG=1 wg-quick up ${ config_path }
        curl -m 5 -s --interface ${ interface_id } icanhazip.com
        wg show
        ip route show
        ip addr show ${ interface_id }
        ping -c1 -W1 ${ endpoint }  > /dev/null 2>&1 && echo "Endpoint ${ endpoint } is reachable" || echo "Endpoint ${ endpoint } is not reachable"
    `
    const curl_command = `curl -m 60 --interface ${ interface_id } -s ${ challenge_url }`
    const cleanup_command = `
        ip route flush table ${ routing_table }
        wg-quick down ${ config_path }
        rm -f /tmp/${ config_path }
        ip link delete ${ interface_id } || echo "No need to force delete interface"
    `


    // Formulate required functions
    const run_cleanup = async ( { silent=false }={} ) => {

        // loop over cleanup commands
        const cleanup_commands = split_ml_commands( cleanup_command )
        for( const command of cleanup_commands ) {
            await run( command, silent )
        }

    }
    const run_test = async () => {

        // Check for ip address conflicts
        const has_conflict = await clean_up_tpn_interfaces( { ip_addresses: [ address ], dryrun: true } )
        if( has_conflict ) {
            log.warn( `IP address ${ address } is already in use by another interface, this indicates failed cleanups. THIS SHOULD NOT HAPPEN.` )
            await clean_up_tpn_interfaces( { ip_addresses: [ address ] } )
        }

        // Write the wireguard config to a file
        const config_cmd = await run( write_config_command, true )
        if( config_cmd.error || config_cmd.stderr ) throw new Error( `Error writing wireguard config: ${ config_cmd.error } ${ config_cmd.stderr }` )

        // loop over network commands
        const network_setup_commands = split_ml_commands( network_setup_command )

        for( const command of network_setup_commands ) {
            const { error, stderr, stdout } = await run( command )
            // if( error || stderr ) throw new Error( `Error setting up network: ${ error } ${ stderr }` )
        }
    

        // Run the curl command
        const { error, stderr, stdout } = await run( curl_command, false, true )
        if( error || stderr ) throw new Error( `Error running curl command: ${ error } ${ stderr }` )
        
        // Isolate the json
        const [ json ] = stdout.match( /{.*}/s ) || []
        if( !json ) {
            log.warn( `No JSON response found in stdout:`, stdout )
            return false
        }

        // Return the json response
        log.info( `Wireguard config for peer ${ peer_id } responded with:`, json )
        return json

    } 

    // Open the challenge url using the wireguard config
    try {

        // Do pre-emptive cleanup in case a previous run messed up
        log.info( `\n 🧹 Running pre-cleanup commands for peer ${ peer_id }}` )
        await run_cleanup( { silent: true } )

        // Solve the challenge from the miner ip
        log.info( `\n 🔎 Running test commands for peer ${ peer_id }` )
        const stdout = await run_test()
        let [ json_response ] = stdout.match( /{.*}/s ) || []
        if( !json_response ) {
            log.warn( `No JSON response found in stdout:`, stdout )
            return { valid: false, message: `No JSON response found in stdout` }
        }
        const { response } = JSON.parse( json_response )

        // Verify that the response is valid
        log.info( `Checkin challenge/response solution ${ challenge }/${ response }` )
        const { correct } = await solve_challenge( { challenge, response } )
        
        // Check that the response is valid
        if( !correct ) {
            log.info( `Wireguard config for peer ${ peer_id } failed challenge` )
            return { valid: false, message: `Wireguard config for peer ${ peer_id } failed challenge` }
        }

        // Run cleanup command
        log.info( `\n 🧹  Running cleanup commands for peer ${ peer_id }` )
        await run_cleanup( { silent: false } )

        // If the response is valid, return true
        log.info( `Wireguard config for peer ${ peer_id } passed ${ challenge } with response ${ response }` )
        return { valid: true, message: `Wireguard config for peer ${ peer_id } passed ${ challenge } with response ${ response }` }

    } catch ( e ) {

        log.error( `Error validating wireguard config for peer ${ peer_id }:`, e )
        await run_cleanup( { silent: true } )
        return { valid: false, message: `Error validating wireguard config for peer ${ peer_id }: ${ e.message }` }

    }

}