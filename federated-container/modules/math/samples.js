import jStat from 'jstat'


// Cochranes formula calculates the sample size 'n'. With this sample size, we can be 'uptime_confidence_fraction' confident that our *measured* uptime from the sample will be within 'error_margin' of the *true* uptime of the entire node population.
// e.g. using 'n' would mean that we are 99% sure that the uptime we are measuring from the sample is within 5% of the real uptime
export function cochrane_sample_size( { uptime_confidence_fraction=.99, expected_proportion_up=.99, error_margin=.05, node_count } ) {

    // Calculate the z-score for the desired confidence level
    const alpha = 1 - uptime_confidence_fraction
    const cumulative_probability = 1 - alpha / 2
    const z_score = jStat.normal.inv( cumulative_probability, 0, 1 )

    // Unadjusted sample size
    const sample_size = z_score**2 * expected_proportion_up * ( 1- expected_proportion_up )  / error_margin**2

    // Do a finite population correction
    const fpc_sample_size = sample_size / ( 1 + ( sample_size - 1 ) / node_count )

    return Math.ceil( fpc_sample_size )

}