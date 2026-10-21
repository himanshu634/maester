import unittest

from docling_core.types.doc import BoundingBox, CoordOrigin

from maester_indexer.sources import Cell, item_source


def box(left: float, top: float, right: float, bottom: float) -> BoundingBox:
    return BoundingBox(l=left, t=top, r=right, b=bottom, coord_origin=CoordOrigin.TOPLEFT)


def cell(left: float, top: float, right: float, bottom: float, from_ocr: bool) -> Cell:
    return Cell(box=box(left, top, right, bottom), from_ocr=from_ocr)


ITEM = box(50, 100, 300, 140)
INSIDE_A = (60, 105, 200, 118)
INSIDE_B = (60, 122, 280, 135)
OUTSIDE = (60, 300, 200, 312)


class ItemSource(unittest.TestCase):
    def test_all_ocr_cells_make_an_ocr_item(self):
        self.assertEqual(item_source([cell(*INSIDE_A, True), cell(*INSIDE_B, True)], ITEM), "ocr")

    def test_no_ocr_cell_makes_a_text_layer_item(self):
        self.assertEqual(item_source([cell(*INSIDE_A, False), cell(*INSIDE_B, False)], ITEM), "text_layer")

    def test_one_of_each_makes_a_mixed_item(self):
        self.assertEqual(item_source([cell(*INSIDE_A, False), cell(*INSIDE_B, True)], ITEM), "mixed")

    def test_a_cell_whose_centre_is_outside_the_box_is_ignored(self):
        self.assertEqual(item_source([cell(*INSIDE_A, False), cell(*OUTSIDE, True)], ITEM), "text_layer")

    def test_a_cell_that_overlaps_the_box_but_is_centred_outside_is_ignored(self):
        overlapping = cell(250, 130, 400, 160, True)  # centre (325, 145)
        self.assertEqual(item_source([cell(*INSIDE_A, False), overlapping], ITEM), "text_layer")

    def test_no_cells_means_no_source(self):
        self.assertIsNone(item_source([], ITEM))
        self.assertIsNone(item_source([cell(*OUTSIDE, True)], ITEM))

    def test_several_boxes_take_the_union(self):
        lower = box(50, 280, 300, 320)
        self.assertEqual(item_source([cell(*INSIDE_A, False), cell(*OUTSIDE, True)], [ITEM, lower]), "mixed")

    def test_boxes_must_have_a_top_left_origin(self):
        bottom_left = BoundingBox(l=50, t=740, r=300, b=700, coord_origin=CoordOrigin.BOTTOMLEFT)
        with self.assertRaises(ValueError):
            item_source([cell(*INSIDE_A, False)], bottom_left)


if __name__ == "__main__":
    unittest.main()
