import unittest

from extract_consolidated import normalize_shipment_status


class ShipmentStatusExtractionTest(unittest.TestCase):
    def test_blank_header_does_not_become_comprar(self):
        self.assertIsNone(normalize_shipment_status(None))
        self.assertIsNone(normalize_shipment_status(''))

    def test_explicit_header_is_preserved(self):
        self.assertEqual(normalize_shipment_status('SALIENDO'), 'SALIENDO')
        self.assertEqual(normalize_shipment_status('LLEGANDO'), 'LLEGANDO')


if __name__ == '__main__':
    unittest.main()
