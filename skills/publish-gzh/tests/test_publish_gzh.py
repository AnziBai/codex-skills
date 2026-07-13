from __future__ import annotations

import importlib.util
import json
import tempfile
import unittest
import urllib.request
from pathlib import Path
from types import SimpleNamespace
from unittest import mock


MODULE_PATH = Path(__file__).parents[1] / "scripts" / "publish_gzh.py"
SPEC = importlib.util.spec_from_file_location("publish_gzh", MODULE_PATH)
assert SPEC and SPEC.loader
publish_gzh = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(publish_gzh)


def article_text(body: str, *, author: str = "桥博士", title: str = "测试文章") -> str:
    return (
        "---\n"
        f"title: {title}\n"
        f"author: {author}\n"
        "date: 2026-07-13\n"
        "---\n\n"
        '<img src="https://example.com/cover.jpg" alt="测试封面" />\n\n'
        f"{body}\n\n"
        f"*{publish_gzh.DISCLAIMER}*\n"
    )


class ValidateArticleTests(unittest.TestCase):
    def test_valid_article_passes_with_manual_source_warning(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            article = Path(temp_dir) / "article.md"
            article.write_text(article_text("这是经过来源核验的测试正文。"), encoding="utf-8")

            result = publish_gzh.validate_article(article)

            self.assertEqual(result["status"], "PASS")
            self.assertEqual(result["blocker_count"], 0)
            self.assertEqual(result["warning_count"], 1)

    def test_utf8_bom_article_passes(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            article = Path(temp_dir) / "article.md"
            article.write_text(article_text("Windows UTF-8 BOM 测试正文。"), encoding="utf-8-sig")

            result = publish_gzh.validate_article(article)

            self.assertEqual(result["status"], "PASS")

    def test_wrong_author_local_markdown_and_forbidden_cta_fail(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            article = Path(temp_dir) / "article.md"
            body = "扫码即可免费领取资料。\n\n![图](C:/private/image.jpg)"
            article.write_text(article_text(body, author="宽论"), encoding="utf-8")

            result = publish_gzh.validate_article(article)
            codes = {item["code"] for item in result["issues"]}

            self.assertEqual(result["status"], "FAIL")
            self.assertTrue({"wrong_author", "local_markdown_image", "reward_cta"}.issubset(codes))

    def test_duplicate_frontmatter_fails(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            article = Path(temp_dir) / "article.md"
            duplicated = article_text(
                "---\ntitle: 第二段\nauthor: 桥博士\n---\n\n正文。"
            )
            article.write_text(duplicated, encoding="utf-8")

            result = publish_gzh.validate_article(article)

            self.assertIn("duplicate_frontmatter", {item["code"] for item in result["issues"]})

    def test_missing_relative_html_image_fails(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            article = Path(temp_dir) / "article.md"
            article.write_text(
                article_text('<img src="assets/missing.jpg" alt="缺失图片" />'),
                encoding="utf-8",
            )

            result = publish_gzh.validate_article(article)

            self.assertIn("missing_local_image", {item["code"] for item in result["issues"]})

    def test_hidden_disclaimer_and_relative_markdown_image_fail(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            article = Path(temp_dir) / "article.md"
            body = (
                f"<!-- {publish_gzh.DISCLAIMER} -->\n\n"
                "正文没有可见免责声明。\n\n"
                "![本地图](assets/local.jpg)"
            )
            text = (
                "---\n"
                "title: 测试文章\n"
                "author: 桥博士\n"
                "---\n\n"
                f"{body}\n"
            )
            article.write_text(text, encoding="utf-8")

            result = publish_gzh.validate_article(article)
            codes = {item["code"] for item in result["issues"]}

            self.assertTrue({"missing_disclaimer", "local_markdown_image"}.issubset(codes))

    def test_unquoted_html_image_and_reference_image_fail(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            article = Path(temp_dir) / "article.md"
            body = (
                "<img src=C:/outside/image.jpg>\n\n"
                "![引用图][img]\n\n"
                "[img]: images/missing.png\n\n"
                f"*{publish_gzh.DISCLAIMER}*"
            )
            text = "---\ntitle: 测试文章\nauthor: 桥博士\n---\n\n" + body
            article.write_text(text, encoding="utf-8")

            result = publish_gzh.validate_article(article)
            codes = {item["code"] for item in result["issues"]}

            self.assertTrue(
                {"quoted_image_src_required", "reference_markdown_image"}.issubset(codes)
            )

    def test_disclaimer_in_link_definition_is_not_visible(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            article = Path(temp_dir) / "article.md"
            text = (
                "---\ntitle: 测试文章\nauthor: 桥博士\n---\n\n"
                '<img src="https://example.com/cover.jpg" alt="封面" />\n\n'
                "正文。\n\n"
                f"[{publish_gzh.DISCLAIMER}]: https://example.com\n"
            )
            article.write_text(text, encoding="utf-8")

            result = publish_gzh.validate_article(article)

            self.assertIn("missing_disclaimer", {item["code"] for item in result["issues"]})

    def test_disclaimer_in_template_is_not_visible(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            article = Path(temp_dir) / "article.md"
            text = (
                "---\ntitle: 测试文章\nauthor: 桥博士\n---\n\n"
                '<img src="https://example.com/cover.jpg" alt="封面" />\n\n'
                f"<template>{publish_gzh.DISCLAIMER}</template>\n"
            )
            article.write_text(text, encoding="utf-8")

            result = publish_gzh.validate_article(article)

            self.assertIn("missing_disclaimer", {item["code"] for item in result["issues"]})

    def test_disclaimer_in_image_alt_is_not_visible(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            article = Path(temp_dir) / "article.md"
            text = (
                "---\ntitle: 测试文章\nauthor: 桥博士\n---\n\n"
                f'<img src="https://example.com/cover.jpg" alt="{publish_gzh.DISCLAIMER}" />\n'
            )
            article.write_text(text, encoding="utf-8")

            result = publish_gzh.validate_article(article)

            self.assertIn("missing_disclaimer", {item["code"] for item in result["issues"]})

    def test_hidden_disclaimer_blocks_publish(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            for opening in ('<div hidden>', '<div style="display:none">'):
                article = Path(temp_dir) / ("article-" + str(abs(hash(opening))) + ".md")
                text = (
                    "---\ntitle: 测试文章\nauthor: 桥博士\n---\n\n"
                    '<img src="https://example.com/cover.jpg" alt="封面" />\n\n'
                    f"{opening}\n*{publish_gzh.DISCLAIMER}*\n</div>\n"
                )
                article.write_text(text, encoding="utf-8")

                result = publish_gzh.validate_article(article)

                self.assertIn("hidden_html", {item["code"] for item in result["issues"]})

    def test_markdown_and_html_cannot_obfuscate_forbidden_claims(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            for claim in ("稳**赚**", "保<span>证</span>收益"):
                article = Path(temp_dir) / ("claim-" + str(abs(hash(claim))) + ".md")
                article.write_text(article_text(claim), encoding="utf-8")

                result = publish_gzh.validate_article(article)

                self.assertIn(
                    "guaranteed_return",
                    {item["code"] for item in result["issues"]},
                )

    def test_duplicate_or_unquoted_src_attribute_fails(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            article = Path(temp_dir) / "article.md"
            body = (
                '<img src=C:/private/secret.jpg src="https://example.com/cover.jpg">\n\n'
                f"*{publish_gzh.DISCLAIMER}*"
            )
            text = "---\ntitle: 测试文章\nauthor: 桥博士\n---\n\n" + body
            article.write_text(text, encoding="utf-8")

            result = publish_gzh.validate_article(article)

            self.assertIn("single_image_src_required", {item["code"] for item in result["issues"]})

    def test_unc_image_is_rejected_before_filesystem_access(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            article = Path(temp_dir) / "article.md"
            article.write_text(
                article_text('<img src="\\\\host\\share\\secret.jpg" alt="UNC" />'),
                encoding="utf-8",
            )

            result = publish_gzh.validate_article(article, [Path(temp_dir)])

            self.assertIn("unc_image_path", {item["code"] for item in result["issues"]})

    def test_local_assets_require_image_extension_and_allowlisted_root(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            assets = root / "assets"
            outside = root / "outside"
            assets.mkdir()
            outside.mkdir()
            secret = assets / "secret.txt"
            secret.write_text("private", encoding="utf-8")
            outside_image = outside / "outside.jpg"
            outside_image.write_bytes(b"image")
            article = root / "article.md"
            article.write_text(
                article_text(
                    f'<img src="{secret.as_posix()}" alt="secret" />\n\n'
                    f'<img src="{outside_image.as_posix()}" alt="outside" />'
                ),
                encoding="utf-8",
            )

            result = publish_gzh.validate_article(article, [assets])
            codes = {item["code"] for item in result["issues"]}

            self.assertTrue(
                {"invalid_image_extension", "image_outside_asset_root"}.issubset(codes)
            )


class ImageIndexTests(unittest.TestCase):
    def test_migrate_legacy_index_uses_relative_paths(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            image_dir = root / "images"
            image_dir.mkdir()
            image = image_dir / "图 1.jpg"
            image.write_bytes(b"not-a-real-image-but-present")
            legacy = root / "legacy.json"
            legacy.write_text(
                json.dumps(
                    {
                        image.name: {
                            "path": "C:/Users/old/private/图 1.jpg",
                            "filename": image.name,
                            "description": "图 1",
                            "embedding": [1.0, 0.0],
                        }
                    },
                    ensure_ascii=False,
                ),
                encoding="utf-8",
            )
            output = root / "portable.json"

            result = publish_gzh.migrate_index(legacy, image_dir, output)
            payload = json.loads(output.read_text(encoding="utf-8"))

            self.assertEqual(result["status"], "PASS")
            self.assertEqual(payload["schema"], publish_gzh.INDEX_SCHEMA)
            self.assertEqual(payload["images"][0]["relative_path"], image.name)
            self.assertNotIn("C:/Users/old", output.read_text(encoding="utf-8"))

    def test_migration_blocks_ambiguous_filenames(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            image_dir = root / "images"
            (image_dir / "a").mkdir(parents=True)
            (image_dir / "b").mkdir(parents=True)
            (image_dir / "a" / "same.jpg").write_bytes(b"a")
            (image_dir / "b" / "same.jpg").write_bytes(b"b")
            legacy = root / "legacy.json"
            legacy.write_text(
                json.dumps({"same.jpg": {"embedding": [1.0, 0.0]}}), encoding="utf-8"
            )

            with self.assertRaises(publish_gzh.WorkflowError):
                publish_gzh.migrate_index(legacy, image_dir, root / "out.json")

    def test_migration_blocks_empty_index(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            image_dir = root / "images"
            image_dir.mkdir()
            (image_dir / "image.jpg").write_bytes(b"image")
            legacy = root / "legacy.json"
            legacy.write_text("{}", encoding="utf-8")

            with self.assertRaises(publish_gzh.WorkflowError):
                publish_gzh.migrate_index(legacy, image_dir, root / "out.json")

    def test_portable_index_requires_images_list(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            image_dir = root / "images"
            image_dir.mkdir()
            index = root / "index.json"
            index.write_text(
                json.dumps({"schema": publish_gzh.INDEX_SCHEMA, "images": None}),
                encoding="utf-8",
            )

            with self.assertRaises(publish_gzh.WorkflowError):
                publish_gzh.portable_image_records(index, image_dir)

    def test_portable_index_rejects_traversal_and_unc_paths(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            image_dir = root / "images"
            image_dir.mkdir()
            for relative_path in ("../outside.jpg", "\\\\host\\share\\image.jpg"):
                index = root / "index.json"
                index.write_text(
                    json.dumps(
                        {
                            "schema": publish_gzh.INDEX_SCHEMA,
                            "images": [
                                {
                                    "relative_path": relative_path,
                                    "embedding": [1.0, 0.0],
                                }
                            ],
                        }
                    ),
                    encoding="utf-8",
                )
                with self.assertRaises(publish_gzh.WorkflowError):
                    publish_gzh.portable_image_records(index, image_dir)


class HttpSafetyTests(unittest.TestCase):
    def test_redirect_handler_never_forwards_request(self) -> None:
        handler = publish_gzh.NoRedirectHandler()
        request = urllib.request.Request(
            "https://open.bigmodel.cn/api/paas/v4/embeddings",
            headers={"Authorization": "Bearer test"},
        )

        redirected = handler.redirect_request(
            request,
            None,
            302,
            "Found",
            {},
            "https://example.com/steal",
        )

        self.assertIsNone(redirected)


class DoctorTests(unittest.TestCase):
    @mock.patch.object(publish_gzh.shutil, "which", return_value="C:/node/node.exe")
    @mock.patch.object(publish_gzh.subprocess, "run")
    def test_node_18_or_newer_passes(self, run: mock.Mock, _which: mock.Mock) -> None:
        run.return_value = SimpleNamespace(returncode=0, stdout="v22.12.0\n", stderr="")

        result = publish_gzh.node_runtime_check()

        self.assertEqual(result["status"], "pass")

    @mock.patch.object(publish_gzh.shutil, "which", return_value="C:/node/node.exe")
    @mock.patch.object(publish_gzh.subprocess, "run")
    def test_node_16_is_blocked(self, run: mock.Mock, _which: mock.Mock) -> None:
        run.return_value = SimpleNamespace(returncode=0, stdout="v16.20.2\n", stderr="")

        result = publish_gzh.node_runtime_check()

        self.assertEqual(result["status"], "block")


class AddImagesTests(unittest.TestCase):
    def test_cover_path_is_yaml_quoted(self) -> None:
        frontmatter = "---\ntitle: 测试\nauthor: 桥博士\n---"

        updated = publish_gzh.update_cover(frontmatter, "C:/assets/cover # 1.jpg")
        _, metadata, _ = publish_gzh.parse_frontmatter(updated + "\n\n正文")

        self.assertIn('cover: "C:/assets/cover # 1.jpg"', updated)
        self.assertEqual(metadata["cover"], "C:/assets/cover # 1.jpg")

    def test_plan_then_atomic_write_preserves_single_frontmatter_and_is_idempotent(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            image_dir = root / "images"
            image_dir.mkdir()
            first = image_dir / "趋势图.jpg"
            second = image_dir / "风险图.jpg"
            first.write_bytes(b"first")
            second.write_bytes(b"second")
            index = root / "index.json"
            index.write_text(
                json.dumps(
                    {
                        "schema": publish_gzh.INDEX_SCHEMA,
                        "images": [
                            {
                                "relative_path": first.name,
                                "filename": first.name,
                                "description": "趋势图",
                                "embedding": [1.0, 0.0],
                            },
                            {
                                "relative_path": second.name,
                                "filename": second.name,
                                "description": "风险图",
                                "embedding": [0.0, 1.0],
                            },
                        ],
                    },
                    ensure_ascii=False,
                ),
                encoding="utf-8",
            )
            paragraph_a = "趋势判断必须先解释规则和证据。" * 12
            paragraph_b = "风险控制需要明确仓位和退出条件。" * 12
            article = root / "article.md"
            article.write_text(article_text(f"{paragraph_a}\n\n{paragraph_b}"), encoding="utf-8")

            def fake_embed(text: str) -> list[float]:
                return [1.0, 0.0] if "趋势" in text else [0.0, 1.0]

            plan = publish_gzh.add_images(
                article,
                image_dir,
                index,
                fake_embed,
                write=False,
                max_images=1,
                min_score=0.1,
                paragraph_gap=0,
                max_candidates=5,
                minimum_chars=20,
            )
            before = article.read_text(encoding="utf-8")
            self.assertFalse(plan["write_applied"])
            self.assertEqual(plan["planned_image_count"], 1)
            self.assertNotIn(publish_gzh.AUTO_IMAGE_MARKER, before)

            written = publish_gzh.add_images(
                article,
                image_dir,
                index,
                fake_embed,
                write=True,
                max_images=1,
                min_score=0.1,
                paragraph_gap=0,
                max_candidates=5,
                minimum_chars=20,
            )
            after = article.read_text(encoding="utf-8")
            self.assertTrue(written["write_applied"])
            self.assertEqual(after.count("\n---"), 1)
            self.assertEqual(after.count(publish_gzh.AUTO_IMAGE_MARKER), 1)
            self.assertIn("cover:", after)

            second_run = publish_gzh.add_images(
                article,
                image_dir,
                index,
                fake_embed,
                write=True,
                max_images=1,
                min_score=0.1,
                paragraph_gap=0,
                max_candidates=5,
                minimum_chars=20,
            )
            self.assertFalse(second_run["write_applied"])
            self.assertEqual(article.read_text(encoding="utf-8"), after)

    def test_embedding_failure_does_not_modify_article(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            image_dir = root / "images"
            image_dir.mkdir()
            image = image_dir / "image.jpg"
            image.write_bytes(b"image")
            index = root / "index.json"
            index.write_text(
                json.dumps(
                    {
                        "schema": publish_gzh.INDEX_SCHEMA,
                        "images": [
                            {
                                "relative_path": image.name,
                                "filename": image.name,
                                "description": "image",
                                "embedding": [1.0, 0.0],
                            }
                        ],
                    }
                ),
                encoding="utf-8",
            )
            article = root / "article.md"
            article.write_text(article_text("足够长的测试段落。" * 20), encoding="utf-8")
            before = article.read_bytes()

            def failing_embed(_: str) -> list[float]:
                raise publish_gzh.WorkflowError("simulated API failure")

            with self.assertRaises(publish_gzh.WorkflowError):
                publish_gzh.add_images(
                    article,
                    image_dir,
                    index,
                    failing_embed,
                    write=True,
                    max_images=1,
                    min_score=0.1,
                    paragraph_gap=0,
                    max_candidates=5,
                    minimum_chars=20,
                )

            self.assertEqual(article.read_bytes(), before)


if __name__ == "__main__":
    unittest.main()
