import unittest

from shared.event_normalization import canonical_event_type, normalize_event


class EventNormalizationTests(unittest.TestCase):
    def test_retail_interaction_aliases_share_stable_trigger(self):
        for alias in ("person_holding_item", "person_interaction", "object_interaction", "item_pickup"):
            with self.subTest(alias=alias):
                self.assertEqual(canonical_event_type(alias), "item_removed_from_shelf")

    def test_explicit_removal_aliases_remain_specific(self):
        for alias in ("item_removed_from_shelf", "product_taken_from_shelf", "shelf_item_removed"):
            with self.subTest(alias=alias):
                self.assertEqual(canonical_event_type(alias), "item_removed_from_shelf")

    def test_unknown_type_remains_extensible(self):
        self.assertEqual(canonical_event_type("Forklift Blocking Aisle"), "forklift_blocking_aisle")

    def test_normalized_event_retains_raw_model_label(self):
        event = {"event_type": "person_holding_item", "payload": {"detail": "shopper at shelf"}}
        normalized = normalize_event(event)
        self.assertEqual(normalized["event_type"], "item_removed_from_shelf")
        self.assertEqual(normalized["payload"]["raw_event_type"], "person_holding_item")
        self.assertEqual(event["event_type"], "person_holding_item")


if __name__ == "__main__":
    unittest.main()
