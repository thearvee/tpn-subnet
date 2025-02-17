// Set up environment
import 'dotenv/config'
import { log } from 'mentie'
log.info( `Starting server` )

// Import express
import { app } from './routes/server.js'

// Identify self on /
app.get( '/', ( req, res ) => res.send( 'Challenge-response server' ) )

// Import challenge/response router
import { router as challenge_response_router } from './routes/challenge-response.js'

app.use( '/challenge', challenge_response_router )

// Start the server
const port = process.env.PORT || 3001
app.listen( port, () => log.info( `Server started on port ${ port }` ) )
process.on( 'SIGTERM', () => app.close() )
process.on( 'SIGINT', () => app.close() )