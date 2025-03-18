import { log } from "mentie"

const { PUBLIC_URL, PUBLIC_VALIDATOR_URL, PUBLIC_PORT } = process.env

// Base url based on environment
let base_url = PUBLIC_VALIDATOR_URL || PUBLIC_URL

// Check if public url has a port
const has_port = `${ PUBLIC_VALIDATOR_URL }`.includes( ':' )

if( has_port && PUBLIC_PORT ) log.error( `You specified a PUBLIC_PORT=${ PUBLIC_PORT } but your PUBLIC_URL=${ PUBLIC_VALIDATOR_URL } also has a port specified, this will break!` )

if( PUBLIC_PORT ) base_url = `${ PUBLIC_VALIDATOR_URL }:${ PUBLIC_PORT }`

export { base_url }