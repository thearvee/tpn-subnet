// Set up environment
import 'dotenv/config'
import { log } from 'mentie'

// Initialize the database
import { init_tables } from './modules/database.js'
await init_tables()
log.info( 'Database initialized' )

// Update maxmind
import { update_maxmind } from './modules/update-maxmind.js'
update_maxmind()
const update_interval_ms = 1000 * 60 * 60 * 24 // 24 hours
log.info( `Updating MaxMind database every ${ update_interval_ms / 1000 / 60 / 60 } hours` )
setInterval( update_maxmind, update_interval_ms )

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
    console.log( 'Server running' )
} )