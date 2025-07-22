// Dependencies
import { log } from "mentie"

// Get relevant environment data
import { get_git_branch_and_hash, check_system_warnings } from './modules/shell.js'
import { readFile } from 'fs/promises'
const { version } = JSON.parse( await readFile( new URL( './package.json', import.meta.url ) ) )
const { branch, hash } = await get_git_branch_and_hash()
const last_start = new Date().toISOString()
const { RUN_MODE } = process.env

// Boot up message
log.info( `${ last_start } - Starting TPN ${ RUN_MODE } component version ${ version } (${ branch }/${ hash })` )

// Check system resources
await check_system_warnings()
