"""Shared deterministic sanity checks on extracted financial statements.

These are plain arithmetic checks (no model calls) meant to catch digit-
transposition or omission errors from the extraction pass. They're heuristic
about matching line-item labels (real statements don't use a fixed
vocabulary), so a failed check is a warning to review, not proof of a wrong
extraction — but a clean pass is a real signal the numbers are internally
consistent.
"""

from pdf_financial_qa.schema import FinancialStatement, LineItem, StatementSection

RELATIVE_TOLERANCE = 0.005  # 0.5%, to absorb rounding in source documents
ABSOLUTE_TOLERANCE = 1.0  # in the statement's own units, before scale_factor


def _close_enough(a: float, b: float) -> bool:
    return abs(a - b) <= max(ABSOLUTE_TOLERANCE, RELATIVE_TOLERANCE * max(abs(a), abs(b)))


def _values_by_period(item: LineItem) -> dict[str, float]:
    return {pv.period: pv.value for pv in item.values if pv.value is not None}


def _check_subtotals(section: StatementSection, warnings: list[str]) -> None:
    by_label = {item.label: item for item in section.line_items}
    for item in section.line_items:
        if not item.is_subtotal or not item.component_labels:
            continue
        components = [by_label[label] for label in item.component_labels if label in by_label]
        missing = [label for label in item.component_labels if label not in by_label]
        if missing:
            warnings.append(
                f"{section.name!r}: subtotal {item.label!r} references unknown "
                f"line items {missing!r} (not checked)"
            )
        subtotal_values = _values_by_period(item)
        for period, subtotal in subtotal_values.items():
            component_sum = sum(
                _values_by_period(c).get(period, 0.0) for c in components
            )
            if not _close_enough(subtotal, component_sum):
                warnings.append(
                    f"{section.name!r}: {item.label!r} = {subtotal} for {period!r}, "
                    f"but its components sum to {component_sum}"
                )


def _find_total(sections: list[StatementSection], name_hint: str) -> dict[str, float] | None:
    """Find a subtotal line item whose own label matches name_hint (e.g. 'Total
    Equity'), keyed by period. Matches on the line item's label rather than its
    section, since a combined section like "Liabilities and Equity" would
    otherwise cause the first subtotal found (e.g. "Total Liabilities") to be
    mistaken for the total being searched for.
    """
    hint = name_hint.lower()
    for section in sections:
        for item in section.line_items:
            if item.is_subtotal and "total" in item.label.lower() and hint in item.label.lower():
                return _values_by_period(item)
    return None


def _check_balance_sheet_identity(statement: FinancialStatement, warnings: list[str]) -> None:
    assets = _find_total(statement.sections, "asset")
    liabilities = _find_total(statement.sections, "liabilit")
    equity = _find_total(statement.sections, "equity")

    if assets is None:
        return  # not a balance sheet, or extraction didn't tag a recognizable total
    if liabilities is None or equity is None:
        warnings.append(
            "Found total assets but couldn't identify a matching total "
            "liabilities and/or total equity line to check the balance sheet identity."
        )
        return

    for period, asset_value in assets.items():
        liability_value = liabilities.get(period)
        equity_value = equity.get(period)
        if liability_value is None or equity_value is None:
            continue
        if not _close_enough(asset_value, liability_value + equity_value):
            warnings.append(
                f"Balance sheet identity fails for {period!r}: "
                f"Assets={asset_value} != Liabilities({liability_value}) + Equity({equity_value})"
            )


def validate_statement(statement: FinancialStatement) -> list[str]:
    warnings: list[str] = []
    for section in statement.sections:
        _check_subtotals(section, warnings)
    _check_balance_sheet_identity(statement, warnings)
    return warnings
