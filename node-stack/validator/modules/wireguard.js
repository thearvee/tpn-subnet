import { log } from "mentie"
import { generate_challenge, solve_challenge } from "./challenge.js"
import { run } from "./shell.js"

const split_ml_commands = commands => commands.split( '\n' ).map( c => c.replace( /#.*$/gm, '' ) ).filter( c => c.trim() ).map( c => c.trim() )

export async function validate_wireguard_config( { peer_config, peer_id } ) {

    // Validate the wireguard config
    if( !peer_config ) return false
    const expected_props = [ '[Interface]', '[Peer]', 'Address', 'PrivateKey', 'ListenPort', 'PublicKey', 'PresharedKey', 'AllowedIPs', 'Endpoint' ]
    const missing_props = expected_props.filter( prop => !peer_config.includes( prop ) )
    if( missing_props.length ) {
        log.warn( `Wireguard config for peer ${ peer_id } is missing required properties:`, missing_props )
        return false
    }
    
    // Generate a challenge on this machine
    const { CI_MODE, CI_IP, PUBLIC_VALIDATOR_URL } = process.env
    let [ ci_ip ] = CI_IP.split( '\n' ).filter( ip => ip.trim() ) || []
    const base_url = CI_MODE ? `http://${ ci_ip }:3000` : PUBLIC_VALIDATOR_URL
    const challenge = await generate_challenge()
    const challenge_url = `${ base_url }/challenge/${ challenge }`

    // The peer_config in CI mode uses SERVERURL=miner, we should resolve that within this container because namespaces cannot use the docker DNS resolver
    // if( CI_MODE ) {
    //     log.info( `Replacing miner with ${ ci_ip } in peer_config` )
    //     peer_config = peer_config.replace( 'miner', ci_ip )
    //     log.info( `Peer config after replacement:` )
    // }

    // Parse the wg config with sane checks
    // 1: Add a Table = off line if it doesn't exist, add it after the Address line
    if( !peer_config.includes( 'Table = off' ) ) peer_config = peer_config.replace( /Address =.*/, `$&\nTable = off` )
    // // 2: Remove the DNS line
    peer_config = peer_config.replace( /^DNS =.*/gm, '' )
    // // 3: if the Address line is not in CIDR add a /32
    // peer_config = peer_config.replace( /Address = (.*)(\/\d+)?/gm, 'Address = $1/32' )
    // // 4: Add a default route in Preup if there is no preup
    // if( !peer_config.includes( 'PreUp' ) ) peer_config = peer_config.replace( /\[Interface\]/, `$&\nPostUp = echo "explain please"` )

    // Remove ipv6 from AllowedIPs line, line looks like AllowedIPs = 0.0.0.0/0, ::/0
    peer_config = peer_config.replace( /,.*::.*\/0/gm, '' )

    log.info( `Parsed wireguard config for peer ${ peer_id }:`, peer_config )


    // Formulate shell commands used for testing and cleanup
    const write_config_command = `
        # Write the wireguard config to a temporary file
        printf "%s" "${ peer_config }" > /tmp/c_wg${ peer_id }.conf && \
        # Chmod the file
        chmod 600 /tmp/c_wg${ peer_id }.conf
    `
    const network_setup_command = `

        ip netns list
        cat /tmp/c_wg${ peer_id }.conf
        WG_DEBUG=1 wg-quick up /tmp/c_wg${ peer_id }.conf

        # Post wireguard setup status checks
        ip route show
        cat /etc/resolv.conf
        ip addr show wg${ peer_id }
        dig +short google.com
        ping -c 4 8.8.8.8
    
    `
    // const network_setup_command = `
    //     ip netns list
    //     cat /tmp/c_wg${ peer_id }.conf

    //     # Networking setup
    //     ip netns add ns_wg${ peer_id } # Create a new network namespace
    //     ip netns exec ns_wg${ peer_id } ip link set lo up # Bring the loopback interface up 

        
    //     # Post network setup status checks
    //     ip netns list
    //     ip netns exec ns_wg$peer_id lsmod | grep wireguard
    //     ip netns exec ns_wg${ peer_id } ls -l /dev/net/tun


    //     # Wireguard setup
    //     ip netns exec ns_wg${ peer_id } ip link set lo up # Bring the loopback interface up
    //     ip netns exec ns_wg$peer_id sh -x -c 'WG_DEBUG=1 wg-quick up ./wg.conf'

    //     # Networking setup within namespace
    //     ip netns exec ns_wg${ peer_id } bash -c 'echo "nameserver 8.8.8.8" >> /etc/resolv.conf'
    //     ip netns exec ns_wg${ peer_id } bash -c 'echo "nameserver 1.1.1.1" >> /etc/resolv.conf'

    //     # Post wireguard setup status checks
    //     ip netns exec ns_wg${ peer_id } ip route show
    //     ip netns exec ns_wg${ peer_id } cat /etc/resolv.conf
    //     ip netns exec ns_wg${ peer_id } ip addr show wg${ peer_id }
    //     ip netns exec ns_wg${ peer_id } dig +short google.com
    //     ip netns exec ns_wg${ peer_id } ping -c 4 8.8.8.8
    
    // `
    const curl_command = `curl -s ${ challenge_url }`
    const cleanup_command = `
        wg-quick down /tmp/c_wg${ peer_id }.conf
        // ip netns exec ns_wg${ peer_id } wg${ peer_id } down # Bring the wireguard interface down
        // ip netns exec ns_wg${ peer_id } ip link delete i_wg${ peer_id } # Delete the wireguard interface
        // ip netns del ns_wg${ peer_id } # Delete the network namespace
        // ip link delete i_wg${ peer_id } > /dev/null 2>&1 | echo "No need to clean up untrashed interface" # Delete the wireguard interface if a previous run failed
        // rm -f /tmp/c_wg${ peer_id }.conf # Remove the temporary wireguard config file
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

        // Write the wireguard config to a file
        const config_cmd = await run( write_config_command, true )
        if( config_cmd.error || config_cmd.stderr ) throw new Error( `Error writing wireguard config: ${ config_cmd.error } ${ config_cmd.stderr }` )

        // loop over network commands
        const network_setup_commands = split_ml_commands( network_setup_command )

        for( const command of network_setup_commands ) {
            const { error, stderr, stdout } = await run( command )
            if( error || stderr ) throw new Error( `Error setting up network: ${ error } ${ stderr }` )
        }
    

        // Run the curl command
        const { error, stderr, stdout } = await run( curl_command )
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
            return false
        }
        const response = JSON.parse( json_response )

        // Verify that the response is valid
        log.info( `Checkin challenge/response solution ${ response.challenge }/${ response.response }` )
        const { correct } = await solve_challenge( { challenge, response } )
        
        // Check that the response is valid
        if( !correct ) {
            log.info( `Wireguard config for peer ${ peer_id } failed challenge` )
            return false
        }

        // Run cleanup command
        log.info( `\n 🧹  Running cleanup commands for peer ${ peer_id }` )
        await run_cleanup( { silent: false } )

        // If the response is valid, return true
        log.info( `Wireguard config for peer ${ peer_id } passed ${ challenge } with response ${ response }` )
        return true

    } catch ( e ) {

        log.error( `Error validating wireguard config for peer ${ peer_id }:`, e )
        return false

    }

}