import asyncio
import aiohttp
from sybil.protocol import Challenge
from typing import List

async def fetch(url):
    async with aiohttp.ClientSession() as session:
        async with session.get(url) as response:
            return await response.json()


async def generate_challenges(k:int, validator_server_url:str)->List[Challenge]:
    try:
        challenges = []
        # Create k concurrent tasks to fetch challenges
        tasks = []
        for _ in range(k):
            tasks.append(fetch(f"{validator_server_url}/challenge/new"))
        
        # Wait for all challenge responses
        responses = await asyncio.gather(*tasks)
        
        # Convert responses to Challenge objects
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
