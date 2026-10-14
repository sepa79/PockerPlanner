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

    def test_topbar_variant_has_the_same_wordmark_without_a_subtitle(self):
        logo = parse(WEB / "pocketplanner-topbar.svg").getroot()
        texts = logo.findall("{http://www.w3.org/2000/svg}text")
        self.assertEqual(len(texts), 1)
        self.assertEqual("".join(texts[0].itertext()), "PocketPlanner")
        for attribute in ("font-family", "font-size", "font-weight", "textLength", "lengthAdjust"):
            self.assertEqual(texts[0].get(attribute), self.wordmark.get(attribute))
        html = (WEB / "index.html").read_text()
        self.assertIn('src="/pocketplanner-topbar.svg"', html)
        self.assertIn('id="app-version"', html)
        self.assertIn("web/pocketplanner-logo.svg", (WEB.parent / "README.md").read_text())


if __name__ == "__main__":
    unittest.main()
