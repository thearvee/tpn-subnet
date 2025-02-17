// Set up environment
import 'dotenv/config'
import { log } from 'mentie'
const update_interval_ms = 1000 * 60 * 60 * 24 // 24 hours
log.info( 'Starting Sybil Network validator component' )

// Initialize the database
import { init_tables } from './modules/database.js'
log.info( 'Initializing database' )
await init_tables()
log.info( 'Database initialized' )

// Update maxmind
import { update_maxmind } from './modules/update-maxmind.js'
log.info( 'Updating MaxMind database' )
await update_maxmind()
log.info( `Updating MaxMind database every ${ update_interval_ms / 1000 / 60 / 60 } hours` )
setInterval( update_maxmind, update_interval_ms )

// Update ip2location
import { update_ip2location_bin } from './modules/ip2location.js'
log.info( 'Updating ip2location database' )
await update_ip2location_bin()
log.info( `Updating ip2location database every ${ update_interval_ms / 1000 / 60 / 60 } hours` )
setInterval( update_ip2location_bin, update_interval_ms )

// Import express
import { app } from './routes/server.js'

// Root route responds with identity
app.get( '/', ( req, res ) => {
    res.send( "I am a Sybil Network validator component" )
} )

// Import and add scoring routes
import { router as score_router } from './routes/score.js'
app.use( '/score', score_router )

// Import and add challenge routes
import { router as challenge_router } from './routes/challenge-response.js'
app.use( '/challenge', challenge_router )

// Listen to requests
app.listen( 3000, () => {
    const { PUBLIC_URL } = process.env
    console.log( `Server running, serving from base url ${ PUBLIC_URL }` )
} )
process.on( 'SIGTERM', () => app.close() )
process.on( 'SIGINT', () => app.close() )