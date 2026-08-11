import math
import unittest

from extract_consolidated import first_present_value


class ExtractOrderFallbackTests(unittest.TestCase):
    def test_uses_secondary_column_when_primary_is_nan(self):
        row = {"INV-REM": math.nan, "NRO_PEDIDO": 2586}
        self.assertEqual(first_present_value(row, "INV-REM", "NRO_PEDIDO"), 2586)

    def test_keeps_primary_column_when_present(self):
        row = {"INV-REM": 2592, "NRO_PEDIDO": 9999}
        self.assertEqual(first_present_value(row, "INV-REM", "NRO_PEDIDO"), 2592)


if __name__ == "__main__":
    unittest.main()
