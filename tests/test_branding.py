import unittest
from xml.etree.ElementTree import parse

from server import WEB


class BrandingTests(unittest.TestCase):
    def setUp(self):
        logo = parse(WEB / "pocketplanner-logo.svg").getroot()
        self.wordmark, self.subtitle = logo.findall("{http://www.w3.org/2000/svg}text")

    def test_logo_matches_shared_typography(self):
        for element, size, weight in ((self.wordmark, "76", "800"), (self.subtitle, "26", "500")):
            with self.subTest(weight=weight):
                self.assertEqual(element.get("font-family"), "'Inter','Segoe UI',Arial,sans-serif")
                self.assertEqual(element.get("font-size"), size)
                self.assertEqual(element.get("font-weight"), weight)
                self.assertIsNone(element.get("letter-spacing"))

    def test_subtitle_spans_the_full_wordmark(self):
        self.assertEqual(self.subtitle.text, "simple test plan")
        self.assertEqual(self.subtitle.get("x"), self.wordmark.get("x"))
        self.assertEqual(self.subtitle.get("textLength"), self.wordmark.get("textLength"))
        self.assertEqual(float(self.subtitle.get("y")) - float(self.wordmark.get("y")), 34)


if __name__ == "__main__":
    unittest.main()
