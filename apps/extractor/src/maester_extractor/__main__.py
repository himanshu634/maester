"""Run the extractor: ``uv run maester-extractor``."""

import logging

import uvicorn
from dotenv import load_dotenv

from maester_extractor.settings import Settings


def main() -> None:
    load_dotenv()  # the repository's .env, when run locally from the root
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
    uvicorn.run("maester_extractor.app:app", host="0.0.0.0", port=Settings.from_env().port, log_level="info")


if __name__ == "__main__":
    main()
