import unittest

from extract_consolidated import normalize_shipment_status


class ShipmentStatusExtractionTest(unittest.TestCase):
    def test_blank_header_does_not_become_comprar(self):
        for blank_value in (None, '', '   ', float('nan')):
            with self.subTest(blank_value=blank_value):
                extracted_status = normalize_shipment_status(blank_value)
                self.assertIsNone(extracted_status)
                self.assertNotEqual(extracted_status, 'COMPRAR')

    def test_explicit_header_is_preserved(self):
        self.assertEqual(normalize_shipment_status('SALIENDO'), 'SALIENDO')
        self.assertEqual(normalize_shipment_status('LLEGANDO'), 'LLEGANDO')

    def test_comprar_is_never_a_shipment_status(self):
        self.assertIsNone(normalize_shipment_status('COMPRAR'))
        self.assertIsNone(normalize_shipment_status(' comprar '))


if __name__ == '__main__':
    unittest.main()
