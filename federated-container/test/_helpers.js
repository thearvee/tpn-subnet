// Test helpers for HTTP requests

/**
 * Fetch helper that handles both JSON and non-JSON responses
 * @param {string} url - The URL to fetch
 * @param {Object} options - Fetch options (method, body, etc.)
 * @returns {Object} - Object with response, data, and error handling
 */
export async function fetch_json( url, options = {} ) {
    const defaultOptions = {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        ...options
    }

    try {
        const response = await fetch( url, defaultOptions )
        
        // Clone the response so we can read it multiple times
        const clonedResponse = response.clone()
        
        try {
            // Try to parse as JSON
            const data = await response.json()
            return { response: clonedResponse, data, success: true }
        } catch ( jsonError ) {
            // If JSON parsing fails, get text and log it
            const text = await clonedResponse.text()
            console.log( `Non-JSON response from ${ url }:`, text )
            return { 
                response: clonedResponse, 
                data: null, 
                text, 
                success: false,
                error: 'Response is not valid JSON'
            }
        }
    } catch ( fetchError ) {
        console.log( `Fetch error for ${ url }:`, fetchError.message )
        return { 
            response: null, 
            data: null, 
            success: false,
            error: fetchError.message 
        }
    }
}
