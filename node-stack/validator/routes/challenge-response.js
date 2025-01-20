import { Router } from "express"
import { generate_challenge } from "../modules/challenge.js"
export const router = Router()

// Generate challenge route
router.get( "/new", async ( req, res ) => {

    // Generate a new challenge
    const challenge = await generate_challenge()

    // Formulate public challenge URL
    const { PUBLIC_URL } = process.env
    const challenge_url = `${ PUBLIC_URL }/challenge/${ challenge }`

    return res.json( { challenge, challenge_url } )

} )