"""Run the extractor: ``uv run maester-extractor``."""

import logging

import uvicorn

from maester_extractor.settings import Settings


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
    uvicorn.run("maester_extractor.app:app", host="0.0.0.0", port=Settings.from_env().port, log_level="info")


if __name__ == "__main__":
    main()
