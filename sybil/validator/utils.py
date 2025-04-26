import asyncio
import aiohttp
from sybil.protocol import Challenge
from typing import List
import bittensor as bt


# Fetch a challenge from a given URL
async def fetch(url):
    async with aiohttp.ClientSession() as session:
        async with session.get(url) as response:
            return await response.json()

# Generate one challenge per miner_uid, appending ?miner_uid=<uid> to each request
async def generate_challenges(miner_uids: List[int], validator_server_url: str) -> List[Challenge]:
    try:
        tasks = []
        for uid in miner_uids:
            bt.logging.info(f"Generating challenge for miner uid: {uid}")
            url = f"{validator_server_url}/challenge/new?miner_uid={uid}"
            tasks.append(fetch(url))
        
        responses = await asyncio.gather(*tasks)
        
        challenges = [
            Challenge(
                challenge=response["challenge"],
                challenge_url=response["challenge_url"]
            ) for response in responses
        ]
        
        return challenges
    except Exception as e:
        print(f"Error generating challenges: {e}")
        return None
