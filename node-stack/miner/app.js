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
const { PORT=3001 } = process.env
const server = app.listen( PORT, () => log.info( `Server started on port ${ PORT }` ) )
const handle_close = () => {
    log.info( 'Closing server' )
    server.close()
    process.exit( 0 )
}
process.on( 'SIGTERM', handle_close )
process.on( 'SIGINT', handle_close )