// const { eslint_config } = require( './index.cjs' )
const { eslint_config } = require( 'airier' )

// Ammend eslint config to include impoer files
eslint_config.plugins.push( 'import' )
eslint_config.rules = {
    ...eslint_config.rules,
    'import/no-unresolved': 'error', // Ensure imports are resolved
    'import/named': 'error', // Ensure named imports correspond to a named export in the remote file
    'import/default': 'error', // Ensure a default export is present, given a default import
    'import/namespace': 'error', // Ensure imported namespaces contain dereferenced properties as they are dereferenced
    'import/no-duplicates': 'error', // Disallow duplicate imports
    'import/extensions': [ 'error', 'always', { js: 'always', json: 'always', ts: 'always' } ], // Enforce file extensions for imports
}
eslint_config.settings[ 'import/resolver' ] = {
    node: {
        extensions: [ '.js', '.jsx', '.ts', '.tsx', '.json' ], // Specify the file extensions to resolve
    }
}

// Export the default eslint config
module.exports = {
    ...eslint_config
}
