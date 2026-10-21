"""XBRL runs: the instances paired with a results filing, read in-process into an artefact per filing.

The same functions the extractor's `/v1/xbrl` route runs read the instance (`parse_instance`, `classify_instance`,
`read_instance`), so a run measures the reader the product has, and its facts keep the wire shape (`XbrlFact`)
with the instance each came from. An instance is used only when it is the one the pair says it is: BSE's code,
the filing's period end and the pair's basis must all be what the instance itself states. Every instance is
recorded, used or not, with the reason it was not used, so the report can name what it did not compare.

A reason is a code, never a message or a value: `XBRL_UNREADABLE:<reason code>`, `XBRL_PAIR_COMPANY`,
`XBRL_PAIR_PERIOD`, `XBRL_PAIR_BASIS` or `XBRL_FORMAT_UNMAPPED`. No figure goes to the log.
"""

from collections.abc import Callable
from datetime import datetime, timezone
import hashlib
from pathlib import Path

from pdf_financial_qa.workflow.errors import ExtractionError
from pdf_financial_qa.xbrl import XBRL_MAP_VERSION, XBRL_PARSER_VERSION
from pdf_financial_qa.xbrl.classify import XbrlClassificationData, classify_instance
from pdf_financial_qa.xbrl.contracts import to_xbrl_read_result
from pdf_financial_qa.xbrl.parser import parse_instance
from pdf_financial_qa.xbrl.read import read_instance

from maester_eval.artefacts import Artefact, InstanceRead, ModelCalls, write_artefact, write_run
from maester_eval.manifest import Filing, SetChoice, XbrlPair
from maester_eval.xbrl_limits import XBRL_LIMITS

PIPELINE_VERSION = "xbrl-1"
MODEL = "xbrl-parser-1"
Log = Callable[[str], None]


def _unique(codes: list[str]) -> list[str]:
    return list(dict.fromkeys(codes))


def _pair_reason(filing: Filing, pair: XbrlPair, found: XbrlClassificationData) -> str | None:
    """Why the instance is not the one the pair says, or None when its code, period end and basis agree."""
    if found.bse_code != filing.bse_code:
        return "XBRL_PAIR_COMPANY"
    if found.period_end is None or found.period_end.isoformat() != filing.period_end:
        return "XBRL_PAIR_PERIOD"
    if found.basis != pair.basis:
        return "XBRL_PAIR_BASIS"
    return None


def _read_pair(filing: Filing, pair: XbrlPair, data: bytes) -> tuple[InstanceRead, dict | None]:
    """The record of one instance and, when it is used, its read as the wire carries it."""
    format_id: str | None = None
    mapped = False
    reason: str | None = None
    wire: dict | None = None
    state: str | None = None
    codes: list[str] = []
    try:
        instance = parse_instance(data, **XBRL_LIMITS)
        found = classify_instance(instance)
        format_id, mapped = found.format.id, found.format.mapped
        reason = _pair_reason(filing, pair, found)
        if reason is None and not mapped:
            reason = "XBRL_FORMAT_UNMAPPED"
        if reason is None:
            read = to_xbrl_read_result(read_instance(instance))
            wire, state = read.to_wire(), read.state
            codes = _unique([warning.code for warning in read.warnings])
    except ExtractionError as exc:
        reason = f"{exc.code}:{exc.message}"
    record = InstanceRead(
        file=pair.file, basis=pair.basis, period=pair.period, filed=pair.filed, sha256=hashlib.sha256(data).hexdigest(),
        format=format_id, mapped=mapped, used=reason is None, reason=reason, state=state,
        facts=0 if wire is None else len(wire["facts"]), warnings=codes)
    return record, wire


def read_filing_xbrl(filing: Filing, corpus: Path) -> Artefact:
    """The artefact of a results filing's paired instances, in the order the manifest lists them.

    Its facts are those of every used instance, each tagged with the instance's file; nothing here picks between
    two instances that hold the same slot. An instance file the corpus does not hold is an `OSError`."""
    started = datetime.now(timezone.utc)
    instances: list[InstanceRead] = []
    facts: list[dict] = []
    checks: list[dict] = []
    warnings: list[dict] = []
    total_bytes = 0
    partial = False
    formats: set[str] = set()
    for pair in filing.xbrl:
        data = (corpus / pair.file).read_bytes()
        total_bytes += len(data)
        record, wire = _read_pair(filing, pair, data)
        instances.append(record)
        if wire is None:
            continue
        partial = partial or wire["state"] == "partial"
        formats.add(f"{record.format}@{XBRL_MAP_VERSION}")
        facts += [{**fact, "instance": pair.file} for fact in wire["facts"]]
        checks += [{**check, "instance": pair.file} for check in wire["checks"]]
        warnings += [{**warning, "instance": pair.file} for warning in wire["warnings"]]
    return Artefact(
        filing_id=filing.id, file=filing.file, company=filing.company, kind=filing.kind,
        period_end=filing.period_end, set=filing.set, stratum=filing.stratum,
        printed_pages_per_page=filing.printed_pages_per_page,
        pipeline_version=PIPELINE_VERSION, prompt_version="+".join(sorted(formats)) or "-", model=MODEL,
        started_at=started.isoformat(), seconds=0, bytes=total_bytes, model_calls=ModelCalls(),
        pages_without_text=[],
        result={"state": "partial" if partial else "complete", "facts": facts, "checks": checks, "warnings": warnings},
        error=None, source="xbrl", instances=instances)


def summary_line(artefact: Artefact) -> str:
    """`<id>: <used>/<pairs> instance(s), <facts> fact(s)`, then the reason codes of the instances left out."""
    used = sum(1 for instance in artefact.instances if instance.used)
    line = f"{artefact.filing_id}: {used}/{len(artefact.instances)} instance(s), {len((artefact.result or {})['facts'])} fact(s)"
    reasons = _unique([i.reason for i in artefact.instances if i.reason is not None])
    return line + (", " + ", ".join(reasons) if reasons else "")


def run_xbrl(filings: list[Filing], corpus: Path, run_dir: Path, eval_set: SetChoice, log: Log = print) -> list[Artefact]:
    """Reads each filing that has pairs in turn and writes its artefact as soon as it is done, as `run_live` does.
    A filing with no pairs has no artefact and is not in the run's `filings`."""
    paired = [filing for filing in filings if filing.xbrl]
    record = {
        "run": run_dir.name, "started_at": datetime.now(timezone.utc).isoformat(), "set": eval_set, "source": "xbrl",
        "pipeline_version": PIPELINE_VERSION, "model": MODEL, "parser_version": XBRL_PARSER_VERSION,
        "map_version": XBRL_MAP_VERSION, "filings": [filing.id for filing in paired],
    }
    write_run(run_dir, record)
    artefacts: list[Artefact] = []
    for filing in paired:
        artefact = read_filing_xbrl(filing, corpus)
        write_artefact(run_dir, artefact)
        log(summary_line(artefact))
        artefacts.append(artefact)
    record["finished_at"] = datetime.now(timezone.utc).isoformat()
    write_run(run_dir, record)
    return artefacts
