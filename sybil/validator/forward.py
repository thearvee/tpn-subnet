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
import aiohttp

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
    
    # Post miner and validator info to the container    
    miners_info = []
    validators_info = []
    for uid in range(self.metagraph.n.item()):
        if self.metagraph.axons[uid].is_serving:
            miners_info.append({
                "uid": uid,
                "ip": self.metagraph.axons[uid].ip,
            })
        elif self.metagraph.validator_permit[uid]:
            validators_info.append({
                "uid": uid,
                "ip": self.metagraph.axons[uid].ip,
                "stake": self.metagraph.S[uid],
            })
    try:
        async with aiohttp.ClientSession() as session:
            async with session.post(
                f"{self.validator_server_url}/protocol/broadcast/miners",
                json={"miners": miners_info}
            ) as resp:
                result = await resp.json()
                if result["success"]:
                    bt.logging.info(f"Broadcasted miners info: {len(miners_info)} miners")
                else:
                    bt.logging.error(f"Failed to broadcast miners info")
                
        async with aiohttp.ClientSession() as session:
            async with session.post(
                f"{self.validator_server_url}/protocol/broadcast/validators",
                json={"validators": validators_info}
            ) as resp:
                result = await resp.json()
                if result["success"]:
                    bt.logging.info(f"Broadcasted validators info: {len(validators_info)} validators")
                else:
                    bt.logging.error(f"Failed to broadcast validators info")
    except Exception as e:
        bt.logging.error(f"Failed to broadcast miners or validators info: {e}")
        
    # get_random_uids is an example method, but you can replace it with your own.
    miner_uids = get_random_uids(self, k=self.config.neuron.sample_size)
    bt.logging.info(f"Miner uids: {miner_uids}")
    
    # Generate k challenges
    challenges = await generate_challenges(miner_uids=miner_uids, validator_server_url=self.validator_server_url)
    bt.logging.info(f"Generated challenges:\n" + "\n".join([str(challenge) for challenge in challenges]))
    
    if challenges is None:
        bt.logging.error("Failed to generate challenges")
        time.sleep(10)
        return

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

    bt.logging.info(f"Received Raw responses: {responses}")
    # Flatten the responses list since each query returns a list with one item
    responses = [resp[0] for resp in responses]

    # Log the results for monitoring purposes.
    bt.logging.info(f"Received responses: {responses}")
    
    # Get scores for the responses
    rewards = await get_rewards([challenge.challenge for challenge in challenges], responses, validator_server_url=self.validator_server_url)
    bt.logging.info(f"Scores: {rewards}")

    if rewards is None:
        bt.logging.error("Failed to get rewards")
        time.sleep(10)
        return

    # Update the scores based on the rewards. You may want to define your own update_scores function for custom behavior.
    self.update_scores(rewards, miner_uids)

    time.sleep(10)
