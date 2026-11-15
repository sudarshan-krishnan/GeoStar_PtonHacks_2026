"""Amazon Bedrock as an optional model provider for the LangChain agents.

Used only when ANTHROPIC_API_KEY is absent and BEDROCK_MODEL_ID plus AWS credentials (AWS_ACCESS_KEY_ID or AWS_PROFILE)
are set. The live demo runs on the Anthropic API; deployment notes are in docs/sponsors/amazon.md.
"""
from __future__ import annotations

import os
from typing import Any

from app import config


def configured() -> bool:
    return bool(config.BEDROCK_MODEL_ID and (os.getenv("AWS_ACCESS_KEY_ID") or os.getenv("AWS_PROFILE")))


def chat_model(temperature: float = 0) -> Any:
    """A LangChain chat model on Bedrock (Converse API)."""
    from langchain_aws import ChatBedrockConverse
    return ChatBedrockConverse(model=config.BEDROCK_MODEL_ID, region_name=config.AWS_REGION, temperature=temperature)
