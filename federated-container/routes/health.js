import { Router } from 'express'
export const router = Router()
import { get_git_branch_and_hash } from '../modules/system/shell.js'
import { readFile } from 'fs/promises'
import { cache } from 'mentie'
import { MINING_POOL_URL } from '../modules/networking/worker.js'
const { version } = JSON.parse( await readFile( new URL( '../package.json', import.meta.url ) ) )
const { branch, hash } = await get_git_branch_and_hash()
const last_start = cache( 'last_start' )
const { RUN_MODE } = process.env


router.get( '/', ( req, res ) => {

    return res.json( {
        notice: `I am a TPN Network ${ RUN_MODE } component running v${ version }`,
        info: 'https://tpn.taofu.xyz',
        version,
        last_start,
        branch,
        hash,
        ...MINING_POOL_URL && { MINING_POOL_URL }
    } )

} )