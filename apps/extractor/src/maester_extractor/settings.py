"""Configuration read from the environment."""

import os
from collections.abc import Mapping
from dataclasses import dataclass


@dataclass(frozen=True)
class Settings:
    port: int = 8790
    # Shared secret the worker sends in x-extractor-secret. Unset on Cloud Run,
    # where IAM (roles/run.invoker) authenticates the worker instead.
    secret: str | None = None
    api_key_set: bool = False
    model: str = "claude-opus-5-5"
    effort: str = "high"
    classify_model: str = "claude-opus-5-5"
    classify_effort: str = "medium"
    classify_model_seconds: float = 60.0
    max_bytes: int = 50 * 1024 * 1024
    heartbeat_seconds: float = 15.0
    deadline_seconds: float = 840.0
    xbrl_max_bytes: int = 20 * 1024 * 1024
    xbrl_max_facts: int = 100_000
    xbrl_deadline_seconds: float = 30.0

    @classmethod
    def from_env(cls, env: Mapping[str, str] = os.environ) -> "Settings":
        return cls(
            port=int(env.get("PORT", "8790")),
            secret=env.get("EXTRACTOR_SECRET") or None,
            # The SDK reads the key itself; settings only record that there is one.
            api_key_set=bool(env.get("ANTHROPIC_API_KEY")),
            model=env.get("EXTRACTOR_MODEL") or "claude-opus-5-5",
            effort=env.get("EXTRACTOR_EFFORT") or "high",
            classify_model=env.get("EXTRACTOR_CLASSIFY_MODEL") or "claude-opus-5-5",
            classify_effort=env.get("EXTRACTOR_CLASSIFY_EFFORT") or "medium",
            classify_model_seconds=float(env.get("CLASSIFY_MODEL_TIMEOUT_SECONDS", "60")),
            max_bytes=int(env.get("EXTRACT_MAX_BYTES", str(50 * 1024 * 1024))),
            heartbeat_seconds=float(env.get("EXTRACT_HEARTBEAT_SECONDS", "15")),
            deadline_seconds=float(env.get("EXTRACT_DEADLINE_SECONDS", "840")),
            xbrl_max_bytes=int(env.get("XBRL_MAX_BYTES", str(20 * 1024 * 1024))),
            xbrl_max_facts=int(env.get("XBRL_MAX_FACTS", "100000")),
            xbrl_deadline_seconds=float(env.get("XBRL_DEADLINE_SECONDS", "30")),
        )
