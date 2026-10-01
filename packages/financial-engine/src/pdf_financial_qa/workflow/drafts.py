"""In-workflow representation of an extracted statement and its deterministic checks."""

from dataclasses import dataclass, field, replace
from decimal import Decimal

from pdf_financial_qa.workflow.values import format_decimal, parse_reported

RELATIVE_TOLERANCE = Decimal("0.005")  # 0.5%, to absorb rounding in source documents
ABSOLUTE_TOLERANCE = Decimal("1.0")  # in the statement's own units, before scaling


@dataclass(frozen=True)
class DraftValue:
    period: str
    text: str
    status: str
    value: Decimal | None

    @classmethod
    def from_text(cls, period: str, text: str) -> "DraftValue":
        status, value = parse_reported(text)
        return cls(period=period, text=text.strip(), status=status, value=value)


@dataclass(frozen=True)
class DraftLine:
    label: str
    page_index: int
    is_subtotal: bool
    component_labels: tuple[str, ...]
    values: tuple[DraftValue, ...]

    def value_for(self, period: str) -> DraftValue | None:
        return next((v for v in self.values if v.period == period), None)


@dataclass(frozen=True)
class DraftSection:
    name: str
    lines: tuple[DraftLine, ...]


@dataclass(frozen=True)
class StatementDraft:
    statement: str
    basis: str
    pages: tuple[int, ...]
    currency: str | None
    unit_label: str | None
    sections: tuple[DraftSection, ...]

    def with_section(self, index: int, section: DraftSection) -> "StatementDraft":
        sections = list(self.sections)
        sections[index] = section
        return replace(self, sections=tuple(sections))


@dataclass(frozen=True)
class Check:
    check_type: str
    section: str | None
    period: str
    subject: str
    status: str
    expected: Decimal | None
    actual: Decimal | None
    detail: str
    # Section names whose re-reading could resolve a failure.
    sections_involved: tuple[str, ...] = field(default_factory=tuple)

    def as_problem(self) -> str:
        return f"{self.subject} for {self.period!r}: {self.detail}"

    def to_wire_fields(self) -> dict:
        return {
            "check_type": self.check_type,
            "section": self.section,
            "period_label": self.period,
            "subject_label": self.subject,
            "status": self.status,
            "expected": format_decimal(self.expected) if self.expected is not None else None,
            "actual": format_decimal(self.actual) if self.actual is not None else None,
            "detail": self.detail,
        }


def _close_enough(a: Decimal, b: Decimal) -> bool:
    return abs(a - b) <= max(ABSOLUTE_TOLERANCE, RELATIVE_TOLERANCE * max(abs(a), abs(b)))


def check_statement(draft: StatementDraft) -> list[Check]:
    checks: list[Check] = []
    for section in draft.sections:
        checks.extend(_check_subtotals(section))
    if draft.statement == "balance_sheet":
        checks.extend(_check_balance_identity(draft))
    return checks


def _check_subtotals(section: DraftSection) -> list[Check]:
    by_label = {line.label: line for line in section.lines}
    out: list[Check] = []
    for line in section.lines:
        if not line.is_subtotal or not line.component_labels:
            continue
        missing = [label for label in line.component_labels if label not in by_label]
        for subtotal in line.values:
            if subtotal.value is None:
                continue
            base = dict(check_type="subtotal", section=section.name, period=subtotal.period, subject=line.label,
                        expected=subtotal.value, sections_involved=(section.name,))
            if missing:
                out.append(Check(status="not_checked", actual=None, detail=f"components not found in the section: {missing}", **base))
                continue
            components = [by_label[label].value_for(subtotal.period) for label in line.component_labels]
            unknown = [label for label, value in zip(line.component_labels, components) if value is None or value.value is None]
            if unknown:
                out.append(Check(status="not_checked", actual=None, detail=f"components without a value: {unknown}", **base))
                continue
            total = sum((value.value for value in components), Decimal(0))  # type: ignore[misc]
            ok = _close_enough(subtotal.value, total)
            out.append(Check(status="passed" if ok else "failed", actual=total,
                             detail="components sum to the subtotal" if ok else "components do not sum to the subtotal", **base))
    return out


def _norm(label: str) -> str:
    return " ".join(label.lower().replace("&", "and").split())


def _find(draft: StatementDraft, predicate) -> tuple[DraftSection, DraftLine] | None:
    for section in draft.sections:
        for line in section.lines:
            if predicate(_norm(line.label)):
                return section, line
    return None


def _check_balance_identity(draft: StatementDraft) -> list[Check]:
    assets = _find(draft, lambda l: l == "total assets") or _find(
        draft, lambda l: "total" in l and "asset" in l and "current" not in l and "liabilit" not in l and "equity" not in l
    )
    if assets is None:
        return []
    combined = _find(draft, lambda l: "total" in l and "equity" in l and "liabilit" in l)
    liabilities = _find(draft, lambda l: "total" in l and "liabilit" in l and "current" not in l and "equity" not in l)
    equity = _find(draft, lambda l: "total" in l and "equity" in l and "liabilit" not in l)

    out: list[Check] = []
    asset_section, asset_line = assets
    for asset in asset_line.values:
        if asset.value is None:
            continue
        base = dict(check_type="balance_identity", section=None, period=asset.period, subject=asset_line.label, expected=asset.value)
        if combined is not None:
            other = combined[1].value_for(asset.period)
            involved = (asset_section.name, combined[0].name)
            if other is None or other.value is None:
                out.append(Check(status="not_checked", actual=None, detail=f"{combined[1].label!r} has no value", sections_involved=involved, **base))
                continue
            actual, against = other.value, combined[1].label
        elif liabilities is not None and equity is not None:
            l_value, e_value = liabilities[1].value_for(asset.period), equity[1].value_for(asset.period)
            involved = (asset_section.name, liabilities[0].name, equity[0].name)
            if l_value is None or l_value.value is None or e_value is None or e_value.value is None:
                out.append(Check(status="not_checked", actual=None, detail="total liabilities or total equity has no value",
                                 sections_involved=involved, **base))
                continue
            actual, against = l_value.value + e_value.value, f"{liabilities[1].label} + {equity[1].label}"
        else:
            out.append(Check(status="not_checked", actual=None, detail="no total liabilities and equity line was identified", **base))
            continue
        ok = _close_enough(asset.value, actual)
        out.append(Check(status="passed" if ok else "failed", actual=actual, sections_involved=tuple(dict.fromkeys(involved)),
                         detail=f"assets equal {against}" if ok else f"assets do not equal {against}", **base))
    return out
