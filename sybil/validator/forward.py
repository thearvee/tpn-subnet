# The MIT License (MIT)
# Copyright © 2023 Yuma Rao
# TODO(developer): Set your name
# Copyright © 2023 <your name>

# Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated
# documentation files (the “Software”), to deal in the Software without restriction, including without limitation
# the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software,
# and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

# The above copyright notice and this permission notice shall be included in all copies or substantial portions of
# the Software.

# THE SOFTWARE IS PROVIDED “AS IS”, WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO
# THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL
# THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION
# OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER
# DEALINGS IN THE SOFTWARE.

import time
import bittensor as bt
import asyncio

from sybil.protocol import Challenge
from sybil.validator.utils import generate_challenges
from sybil.utils.uids import get_random_uids
from sybil.validator.reward import get_rewards
async def forward(self):
    """
    The forward function is called by the validator every time step.

    It is responsible for querying the network and scoring the responses.

    Args:
        self (:obj:`bittensor.neuron.Neuron`): The neuron object which contains all the necessary state for the validator.

    """
    # TODO(developer): Define how the validator selects a miner to query, how often, etc.
    
    # get_random_uids is an example method, but you can replace it with your own.
    miner_uids = get_random_uids(self, k=self.config.neuron.sample_size)
    bt.logging.info(f"Miner uids: {miner_uids}")
    
    # Generate k challenges
    challenges = await generate_challenges(k=len(miner_uids))
    bt.logging.info(f"Generated challenge: {challenges}")

    # Create concurrent queries, one for each challenge-miner pair
    async_queries = [
        self.dendrite(
            axons=[self.metagraph.axons[uid]],
            synapse=challenge,
            deserialize=True,
        )
        for uid, challenge in zip(miner_uids, challenges)
    ]

    # Execute all queries concurrently
    responses = await asyncio.gather(*async_queries)

    # Flatten the responses list since each query returns a list with one item
    responses = [resp[0] for resp in responses]

    # Log the results for monitoring purposes.
    bt.logging.info(f"Received responses: {responses}")
    
    # Get scores for the responses
    rewards = await get_rewards([challenge.challenge for challenge in challenges], responses)
    bt.logging.info(f"Scores: {rewards}")

    # Update the scores based on the rewards. You may want to define your own update_scores function for custom behavior.
    self.update_scores(rewards, miner_uids)
    time.sleep(10)
