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
        self.assertFalse(is_supported_finding("fallen_person", True))

    def test_unattended_objects_require_grounding(self):
        self.assertFalse(is_supported_finding("unattended_bag", None))
        self.assertFalse(is_supported_finding("unattended_item", False))
        self.assertTrue(is_supported_finding("unattended_bag", True))

    def test_object_interactions_require_grounding_and_real_motion(self):
        self.assertFalse(is_supported_finding("item_pickup", None, 0.08))
        self.assertFalse(is_supported_finding("item_pickup", True, 0.02))
        self.assertTrue(is_supported_finding(
            "item_pickup", True, 0.05, [{"phrase": "person"}],
            "person picks an item from the shelf",
        ))
        self.assertTrue(is_supported_finding(
            "item_pickup", True, 0.05,
            [{"phrase": "person"}, {"phrase": "book"}],
            "person removes a book from the shelf",
        ))
        self.assertFalse(is_supported_finding("item_consumption", True, 0.05, [{"phrase": "person"}]))
        self.assertTrue(is_supported_finding(
            "person_interaction", True, 0.10,
            [{"phrase": "person"}, {"phrase": "box"}],
            "person picks up a box",
        ))
        self.assertFalse(is_supported_finding("spill", None, 0.0))
        self.assertTrue(is_supported_finding("spill", True, 0.0))

    def test_item_removed_requires_a_transition_not_static_holding(self):
        person = [{"phrase": "person", "confidence": 0.8}]
        self.assertFalse(is_supported_finding(
            "item_removed_from_shelf", True, 0.08, person,
            "person holding a bag",
        ))
        self.assertTrue(is_supported_finding(
            "item_removed_from_shelf", True, 0.08, person,
            "person picks a bottle off the shelf",
        ))


if __name__ == "__main__":
    unittest.main()
