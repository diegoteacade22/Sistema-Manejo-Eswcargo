#!/usr/bin/env python3
"""Regression checks for Cash Flow sign convention without reading Sheets."""

import importlib.util
from pathlib import Path

MODULE_PATH = Path(__file__).with_name("export-cash-flow-raw-transactions.py")
SPEC = importlib.util.spec_from_file_location("cashflow_export", MODULE_PATH)
MODULE = importlib.util.module_from_spec(SPEC)
assert SPEC and SPEC.loader
SPEC.loader.exec_module(MODULE)

assert MODULE.transaction_from_balance_change(0, 20_000) == ("PAGO", 20_000)
assert MODULE.transaction_from_balance_change(20_000, 1_275) == ("CARGO", -18_725)
assert MODULE.transaction_from_balance_change(11_956, 11_656) == ("CARGO", -300)
assert MODULE.transaction_from_balance_change(1_286, 1_286) is None

print("OK: Cash Flow conserva el signo contable del cambio de saldo.")
