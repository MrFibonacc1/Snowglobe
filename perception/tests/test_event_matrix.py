import unittest

from perception.vlm import _verdicts_from_discovery
from shared.event_normalization import is_supported_finding


class DiscoveryEventMatrixTests(unittest.TestCase):
    def test_representative_product_events_have_stable_types(self):
        findings = [
            {"event_type": "wet_floor", "confidence": .9, "severity": "high"},
            {"event_type": "worker_without_hard_hat", "confidence": .8, "severity": "high"},
            {"event_type": "crowded_area", "confidence": .7, "severity": "medium"},
            {"event_type": "person_holding_item", "confidence": .85, "severity": "medium"},
        ]
        types = [v.event_type for v in _verdicts_from_discovery(findings, raw="test")]
        self.assertEqual(types, ["spill", "missing_ppe", "overcrowding", "item_removed_from_shelf"])

    def test_person_on_ground_requires_grounding(self):
        self.assertFalse(is_supported_finding("person_on_ground", None))
        self.assertFalse(is_supported_finding("fallen_person", False))
        self.assertTrue(is_supported_finding("fallen_person", True))


if __name__ == "__main__":
    unittest.main()
