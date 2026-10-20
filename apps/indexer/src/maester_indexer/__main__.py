"""Run the indexer: ``uv run maester-indexer``."""

import logging
import os

import uvicorn


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
    port = int(os.environ.get("PORT") or 8791)
    uvicorn.run("maester_indexer.app:create_app", factory=True, host="0.0.0.0", port=port, log_level="info")


if __name__ == "__main__":
    main()
