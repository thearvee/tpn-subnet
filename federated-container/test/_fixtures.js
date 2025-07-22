// Test fixtures for protocol tests
export const BASE_URL = 'http://localhost:3000'

// Sample neuron data for testing
export const validNeurons = [
    {
        uid: 1,
        ip: '192.168.1.1',
        validator_trust: 0.8,
        trust: 0.7,
        alpha_stake: 1000,
        stake_weight: 500,
        block: 12345,
        hotkey: 'hotkey1',
        coldkey: 'coldkey1'
    },
    {
        uid: 2,
        ip: '192.168.1.2',
        validator_trust: 0,
        trust: 0.6,
        alpha_stake: 800,
        stake_weight: 400,
        block: 12345,
        hotkey: 'hotkey2',
        coldkey: 'coldkey2'
    }
]

export const validatorNeuron = {
    uid: 1,
    ip: '192.168.1.1',
    validator_trust: 0.8,
    trust: 0.7,
    alpha_stake: 1000,
    stake_weight: 500,
    block: 12345,
    hotkey: 'hotkey1',
    coldkey: 'coldkey1'
}

export const minerNeuron = {
    uid: 2,
    ip: '192.168.1.2',
    validator_trust: 0,
    trust: 0.6,
    alpha_stake: 800,
    stake_weight: 400,
    block: 12345,
    hotkey: 'hotkey2',
    coldkey: 'coldkey2'
}

export const weightCopierNeuron = {
    uid: 3,
    ip: '0.0.0.0',
    validator_trust: 0.8,
    trust: 0.7,
    alpha_stake: 1000,
    stake_weight: 500,
    block: 12345,
    hotkey: 'hotkey3',
    coldkey: 'coldkey3'
}

export const neuronWithBadIP = {
    uid: 4,
    ip: '   192.168.1.1   ',
    validator_trust: 0.8,
    trust: 0.7,
    alpha_stake: 1000,
    stake_weight: 500,
    block: 12345,
    hotkey: 'hotkey4',
    coldkey: 'coldkey4'
}

export const neuronWithInvalidIP = {
    uid: 5,
    ip: 'invalid-ip',
    validator_trust: 0.8,
    trust: 0.7,
    alpha_stake: 1000,
    stake_weight: 500,
    block: 12345,
    hotkey: 'hotkey5',
    coldkey: 'coldkey5'
}

export const incompleteNeuron = {
    uid: 6,
    // Missing required properties
    ip: '192.168.1.6'
}

export const neuronWithNulls = {
    uid: null,
    ip: null,
    validator_trust: null,
    trust: null,
    alpha_stake: null,
    stake_weight: null,
    block: null,
    hotkey: null,
    coldkey: null
}

export const neuronWithZeros = {
    uid: 0,
    ip: '192.168.1.1',
    validator_trust: 0,
    trust: 0,
    alpha_stake: 0,
    stake_weight: 0,
    block: 0,
    hotkey: '',
    coldkey: ''
}

// Generate large neuron array for performance testing
export const generateLargeNeuronArray = ( size = 1000 ) => {
    return Array.from( { length: size }, ( _, i ) => ( {
        uid: i + 1,
        ip: `203.0.113.${ i % 254 + 1 }`, // Use TEST-NET-3 public IP range (RFC 5737)
        validator_trust: i % 2 === 0 ? 0.8 : 0,
        trust: 0.7,
        alpha_stake: 1000,
        stake_weight: 500,
        block: 12345,
        hotkey: `hotkey${ i }`,
        coldkey: `coldkey${ i }`
    } ) )
}

export const mixedNeurons = [
    validatorNeuron,
    incompleteNeuron,
    minerNeuron
]
