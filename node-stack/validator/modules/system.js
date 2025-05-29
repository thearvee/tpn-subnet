import os from 'os'

/**
 * Convert bytes to a human-readable string.
 */
function format_bytes( bytes ) {
    const units = [ 'B', 'KB', 'MB', 'GB', 'TB' ]
    let i = 0
    while( bytes >= 1024 && i < units.length - 1 ) {
        bytes /= 1024
        i++
    }
    return `${ bytes.toFixed( 2 ) } ${ units[i] }`
}

/**
 * Log current memory usage and percentages.
 */
export function log_memory_stats() {
    const mem = process.memoryUsage()
    const totalSystemMem = os.totalmem()
    const usedRSSPercent = mem.rss / totalSystemMem * 100

    let message = `Memory Usage:\n`
    message += `RSS: ${ format_bytes( mem.rss ) } (${ usedRSSPercent.toFixed( 2 ) }% of total system memory)\n`
    message += `Heap Total: ${ format_bytes( mem.heapTotal ) }\n`
    message += `Heap Used: ${ format_bytes( mem.heapUsed ) }\n`
    message += `External: ${ format_bytes( mem.external ) }\n`
    message += `Array Buffers: ${ format_bytes( mem.arrayBuffers ) }\n`
    message += `Total System Memory: ${ format_bytes( totalSystemMem ) }\n`
    message += `Free System Memory: ${ format_bytes( totalSystemMem - mem.rss ) }\n`
    
    return message

}

