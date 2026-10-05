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
    project: str | None = None
    location: str = "us-central1"
    model: str = "gemini-2.5-pro"
    classify_model: str = "gemini-2.5-flash"
    classify_model_seconds: float = 60.0
    max_bytes: int = 50 * 1024 * 1024
    heartbeat_seconds: float = 15.0
    deadline_seconds: float = 840.0

    @classmethod
    def from_env(cls, env: Mapping[str, str] = os.environ) -> "Settings":
        return cls(
            port=int(env.get("PORT", "8790")),
            secret=env.get("EXTRACTOR_SECRET") or None,
            project=env.get("GOOGLE_CLOUD_PROJECT") or None,
            location=env.get("VERTEX_LOCATION") or "us-central1",
            model=env.get("GEMINI_MODEL") or "gemini-2.5-pro",
            classify_model=env.get("GEMINI_CLASSIFY_MODEL") or "gemini-2.5-flash",
            classify_model_seconds=float(env.get("CLASSIFY_MODEL_TIMEOUT_SECONDS", "60")),
            max_bytes=int(env.get("EXTRACT_MAX_BYTES", str(50 * 1024 * 1024))),
            heartbeat_seconds=float(env.get("EXTRACT_HEARTBEAT_SECONDS", "15")),
            deadline_seconds=float(env.get("EXTRACT_DEADLINE_SECONDS", "840")),
        )
