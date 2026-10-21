"""The limits every `parse_instance` call in the harness passes: the extractor's defaults (`XBRL_MAX_BYTES`,
`XBRL_MAX_FACTS`, `XBRL_DEADLINE_SECONDS`), so a file the extractor would refuse is refused here too.

Use it as `parse_instance(data, **XBRL_LIMITS)`.
"""

XBRL_LIMITS = {"max_bytes": 20971520, "max_facts": 100000, "deadline_seconds": 30.0}
