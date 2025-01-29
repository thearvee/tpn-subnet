import { wait_for_server_up } from "./helpers"
import { describe, test, expect } from 'vitest'
import fetch from 'node-fetch'

describe(  'Challenge', () => {

    test( 'Solves provided challenges', async () => {

        // Wait for sever to be up
        console.log( 'Waiting for server to be up' )
        await wait_for_server_up()
        console.log( 'Server is up' )

        // Grab a challenge from localhost:3000/challenge/new
        const challenge_res = await fetch( 'http://localhost:3000/challenge/new' )
        const { challenge_url } = await challenge_res.json()
        console.log( `Challenge url: ${ challenge_url }` )

        // Post the challenge url to localhost:3001/challenge in url json key
        const solution_response = await fetch( 'http://localhost:3001/challenge', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify( { url: challenge_url } )
        } )
        const score = await solution_response.json()
        console.log( `Score:`, score )

        // Require properties speed_score, uniqueness_score
        expect( score ).toHaveProperty( 'speed_score' )
        expect( score ).toHaveProperty( 'uniqueness_score' )

    } )

} )
