import { log } from "mentie"

const { PUBLIC_URL, PUBLIC_VALIDATOR_URL, PUBLIC_PORT } = process.env

// Base url based on environment
let base_url = PUBLIC_VALIDATOR_URL || PUBLIC_URL

// Remove trailing slash
base_url = base_url.replace( /\/$/, '' )

// Check if public url has a port
const has_port = `${ base_url }`.includes( ':' )

if( has_port && PUBLIC_PORT ) log.error( `You specified a PUBLIC_PORT=${ PUBLIC_PORT } but your base url ${ PUBLIC_VALIDATOR_URL } also has a port specified, this will break!` )

if( PUBLIC_PORT ) base_url = `${ base_url }:${ PUBLIC_PORT }`

export { base_url }