import unittest

from extract_consolidated import normalize_optional_status


class ExtractOrderStatusTests(unittest.TestCase):
    def test_blank_status_remains_unspecified(self):
        self.assertIsNone(normalize_optional_status(None))
        self.assertIsNone(normalize_optional_status(''))

    def test_explicit_order_header_status_is_preserved(self):
        self.assertEqual(normalize_optional_status('ENTREGADO'), 'ENTREGADO')
        self.assertEqual(normalize_optional_status('LLEGANDO'), 'LLEGANDO')


if __name__ == '__main__':
    unittest.main()
