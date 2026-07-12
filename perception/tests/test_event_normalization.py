import unittest

from shared.event_normalization import canonical_event_type, normalize_event


class EventNormalizationTests(unittest.TestCase):
    def test_explicit_retail_removal_aliases_share_stable_trigger(self):
        for alias in (
            "person_holding_item", "item_pickup", "shopper picked up product",
            "customer taking an item from the shelf", "product was removed from display",
        ):
            with self.subTest(alias=alias):
                self.assertEqual(canonical_event_type(alias), "item_removed_from_shelf")

    def test_ambiguous_interactions_do_not_trigger_inventory_mutations(self):
        for label in ("person_interaction", "object_interaction", "product_interaction"):
            with self.subTest(label=label):
                self.assertEqual(canonical_event_type(label), label)

    def test_common_safety_variants_are_canonical(self):
        cases = {
            "water spilled on floor": "spill",
            "employee not wearing a hard hat": "missing_ppe",
            "too many people in aisle": "overcrowding",
            "person lying on the ground": "person_on_ground",
        }
        for label, expected in cases.items():
            with self.subTest(label=label):
                self.assertEqual(canonical_event_type(label), expected)

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
