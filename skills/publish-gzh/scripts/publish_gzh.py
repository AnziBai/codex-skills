#!/usr/bin/env python3
"""Portable preflight, validation, and image tooling for publish-gzh."""

from __future__ import annotations

import argparse
import html
import json
import math
import os
import re
import shutil
import subprocess
import sys
import tempfile
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable, Iterable


DISCLAIMER = "免责声明：本文介绍的是量化分析技术与方法论，不构成投资建议。投资有风险，入市需谨慎。"
DISCLAIMER_LINE_RE = re.compile(
    rf"(?m)^\s*\*{re.escape(DISCLAIMER)}\*\s*$"
)
INDEX_SCHEMA = "publish-gzh-image-index-v1"
GLM_API_KEY_ENV = "GLM_API_KEY"
GLM_BASE_URL = "https://open.bigmodel.cn/api/paas/v4"
IMAGE_SUFFIXES = {".jpg", ".jpeg", ".png", ".webp", ".gif"}
AUTO_IMAGE_MARKER = "<!-- publish-gzh:image -->"
FRONTMATTER_RE = re.compile(
    r"\A---[ \t]*\r?\n(?P<meta>.*?)\r?\n---[ \t]*(?:\r?\n|\Z)", re.DOTALL
)
SECOND_FRONTMATTER_RE = re.compile(
    r"^---[ \t]*\r?\n(?:[^\r\n:]+:[^\r\n]*\r?\n)+---[ \t]*(?:\r?$|\r?\n)",
    re.MULTILINE,
)
MARKDOWN_IMAGE_RE = re.compile(r"!\[[^\]]*\]\(\s*(?P<src>[^)]+?)\s*\)", re.IGNORECASE)
REFERENCE_IMAGE_RE = re.compile(r"!\[[^\]]*\]\[[^\]]*\]", re.IGNORECASE)
ALL_HTML_IMAGE_RE = re.compile(r"<img\b[^>]*>", re.IGNORECASE)
HTML_IMAGE_RE = re.compile(
    r"<img\b[^>]*\bsrc\s*=\s*[\"'](?P<src>[^\"']+)[\"'][^>]*>", re.IGNORECASE
)
PLACEHOLDER_RE = re.compile(r"(?:\bTODO\b|\bTBD\b|\[待补充\]|<待补充>|这里填写|your-key)", re.IGNORECASE)
FORBIDDEN_PATTERNS = (
    ("reward_cta", re.compile(r"扫码.{0,16}(?:领取|获取|得到)|免费领取", re.IGNORECASE)),
    ("free_animation", re.compile(r"\bFREE\b.{0,8}(?:动图|gif)|免费free\.gif", re.IGNORECASE)),
    ("guaranteed_return", re.compile(r"稳赚|保证收益|承诺收益|保本(?:保收益)?|零风险", re.IGNORECASE)),
    ("advisory", re.compile(r"荐股|代客理财|一对一账户诊断|具体买卖建议", re.IGNORECASE)),
)
HIDDEN_HTML_RE = re.compile(
    r"<[^>]+(?:\bhidden\b|display\s*:\s*none|visibility\s*:\s*hidden)[^>]*>",
    re.IGNORECASE,
)


class WorkflowError(RuntimeError):
    """A user-actionable workflow failure that is safe to print."""


class NoRedirectHandler(urllib.request.HTTPRedirectHandler):
    """Prevent bearer credentials from following redirects."""

    def redirect_request(
        self,
        req: Any,
        fp: Any,
        code: int,
        msg: str,
        headers: Any,
        newurl: str,
    ) -> None:
        return None


def utc_now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def read_utf8(path: Path) -> str:
    try:
        return path.read_text(encoding="utf-8-sig")
    except UnicodeDecodeError as exc:
        raise WorkflowError(f"File is not valid UTF-8: {path}") from exc
    except OSError as exc:
        raise WorkflowError(f"Cannot read file: {path}: {exc}") from exc


def atomic_write_text(path: Path, content: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temp_path: Path | None = None
    try:
        with tempfile.NamedTemporaryFile(
            mode="w",
            encoding="utf-8",
            newline="",
            dir=path.parent,
            prefix=f".{path.name}.",
            suffix=".tmp",
            delete=False,
        ) as handle:
            handle.write(content)
            handle.flush()
            os.fsync(handle.fileno())
            temp_path = Path(handle.name)
        os.replace(temp_path, path)
    except OSError as exc:
        raise WorkflowError(f"Atomic write failed for {path}: {exc}") from exc
    finally:
        if temp_path and temp_path.exists():
            temp_path.unlink()


def atomic_write_json(path: Path, payload: Any) -> None:
    atomic_write_text(path, json.dumps(payload, ensure_ascii=False, indent=2) + "\n")


def line_number(text: str, offset: int) -> int:
    return text.count("\n", 0, offset) + 1


def parse_frontmatter(text: str) -> tuple[str, dict[str, str], str]:
    match = FRONTMATTER_RE.match(text)
    if not match:
        return "", {}, text

    metadata: dict[str, str] = {}
    for raw_line in match.group("meta").splitlines():
        key, separator, value = raw_line.partition(":")
        if separator and key.strip():
            metadata[key.strip()] = value.strip().strip("\"'")
    return match.group(0).rstrip("\r\n"), metadata, text[match.end() :]


def visible_markdown_text(text: str) -> str:
    without_comments = re.sub(r"<!--.*?-->", "", text, flags=re.DOTALL)
    without_code = re.sub(r"```.*?```", "", without_comments, flags=re.DOTALL)
    without_hidden_html = re.sub(
        r"<(?:template|script|style|noscript)\b[^>]*>.*?</(?:template|script|style|noscript)>",
        "",
        without_code,
        flags=re.DOTALL | re.IGNORECASE,
    )
    return re.sub(r"(?m)^\s*\[[^\]]+\]:\s*\S+.*$", "", without_hidden_html)


def rendered_plain_text(text: str) -> str:
    visible = visible_markdown_text(text)
    without_tags = re.sub(r"<[^>]+>", "", visible)
    without_links = re.sub(r"\[([^\]]+)\]\([^)]+\)", r"\1", without_tags)
    return html.unescape(re.sub(r"[`*_~]", "", without_links))


def is_remote_asset(source: str) -> bool:
    return bool(re.match(r"^(?:https?:)?//|^data:", source, re.IGNORECASE))


def local_asset_issues(
    article: Path,
    source: str,
    line: int,
    asset_roots: list[Path],
) -> list[dict[str, Any]]:
    issues: list[dict[str, Any]] = []
    if source.lower().startswith("file:"):
        return [
            issue(
                "file_url_image",
                "Local images must use a filesystem path, not a file:// URL.",
                line=line,
            )
        ]
    if is_remote_asset(source):
        return issues
    if source.startswith("\\\\"):
        return [
            issue(
                "unc_image_path",
                "UNC image paths are not allowed; copy the image under an explicit local asset root.",
                line=line,
            )
        ]

    if re.match(r"^[A-Za-z]:[\\/]", source):
        local_path = Path(source)
    else:
        local_path = article.parent / source
    resolved = local_path.resolve()

    if "\\" in source:
        issues.append(
            issue(
                "backslash_image_path",
                "Local HTML image paths must use forward slashes.",
                line=line,
            )
        )
    if resolved.suffix.lower() not in IMAGE_SUFFIXES:
        issues.append(
            issue(
                "invalid_image_extension",
                f"Local asset is not an allowed image type: {source}",
                line=line,
            )
        )
    if not resolved.is_file():
        issues.append(
            issue(
                "missing_local_image",
                f"Local image does not exist: {source}",
                line=line,
            )
        )
        return issues

    if not asset_roots:
        issues.append(
            issue(
                "asset_root_required",
                "Local images require at least one explicit --asset-root allowlist.",
                line=line,
            )
        )
        return issues

    allowed = False
    for root in asset_roots:
        try:
            resolved.relative_to(root.resolve())
            allowed = True
            break
        except ValueError:
            continue
    if not allowed:
        issues.append(
            issue(
                "image_outside_asset_root",
                f"Local image is outside the allowed asset roots: {source}",
                line=line,
            )
        )
    return issues


def issue(code: str, message: str, *, severity: str = "error", line: int | None = None) -> dict[str, Any]:
    result: dict[str, Any] = {"severity": severity, "code": code, "message": message}
    if line is not None:
        result["line"] = line
    return result


def validate_article(path: Path, asset_roots: list[Path] | None = None) -> dict[str, Any]:
    if not path.is_file():
        return {
            "status": "FAIL",
            "article": str(path.resolve()),
            "issues": [issue("missing_article", f"Article does not exist: {path}")],
        }

    text = read_utf8(path)
    frontmatter, metadata, body = parse_frontmatter(text)
    visible_body = visible_markdown_text(body)
    issues: list[dict[str, Any]] = []
    asset_roots = asset_roots or []

    if not frontmatter:
        issues.append(issue("missing_frontmatter", "Article must start with one YAML frontmatter block.", line=1))
    else:
        title = metadata.get("title", "").strip()
        author = metadata.get("author", "").strip()
        if not title:
            issues.append(issue("missing_title", "Frontmatter must contain a final title."))
        elif len(title) > 64:
            issues.append(issue("title_too_long", f"Title has {len(title)} characters; maximum is 64."))
        if author != "桥博士":
            issues.append(issue("wrong_author", "Frontmatter author must be exactly 桥博士."))
        if SECOND_FRONTMATTER_RE.search(visible_body):
            issues.append(issue("duplicate_frontmatter", "A second frontmatter block appears after the first one."))

        cover = metadata.get("cover", "").strip()
        if cover:
            cover_match = re.search(r"(?m)^cover\s*:", frontmatter)
            cover_line = line_number(frontmatter, cover_match.start()) if cover_match else 1
            issues.extend(local_asset_issues(path, cover, cover_line, asset_roots))

    if not body.strip():
        issues.append(issue("empty_body", "Article body is empty."))

    if not DISCLAIMER_LINE_RE.search(visible_body):
        issues.append(
            issue(
                "missing_disclaimer",
                "Required investment-risk disclaimer must appear as its own italic Markdown line.",
            )
        )

    for match in HIDDEN_HTML_RE.finditer(text):
        issues.append(
            issue(
                "hidden_html",
                "Hidden HTML content is not allowed in a publishable article.",
                line=line_number(text, match.start()),
            )
        )

    for match in MARKDOWN_IMAGE_RE.finditer(text):
        source = match.group("src").strip().strip("<>").split(maxsplit=1)[0]
        if not is_remote_asset(source):
            issues.append(
                issue(
                    "local_markdown_image",
                    "Local images must use supported HTML <img> tags, not Markdown image syntax.",
                    line=line_number(text, match.start()),
                )
            )

    for match in REFERENCE_IMAGE_RE.finditer(text):
        issues.append(
            issue(
                "reference_markdown_image",
                "Reference-style Markdown images are not supported; use an inline web URL or an allowed HTML image.",
                line=line_number(text, match.start()),
            )
        )

    smart_src = re.search(r"<img\b[^>]*\bsrc\s*=\s*[“”]", text, re.IGNORECASE)
    if smart_src:
        issues.append(
            issue(
                "smart_quote_src",
                "HTML img src attributes must use ASCII quotes.",
                line=line_number(text, smart_src.start()),
            )
        )

    quoted_image_matches = list(HTML_IMAGE_RE.finditer(text))
    for match in ALL_HTML_IMAGE_RE.finditer(text):
        tag = match.group(0)
        src_count = len(re.findall(r"\bsrc\s*=", tag, re.IGNORECASE))
        quoted_src_count = len(
            re.findall(r"\bsrc\s*=\s*[\"'][^\"']+[\"']", tag, re.IGNORECASE)
        )
        if src_count != 1:
            issues.append(
                issue(
                    "single_image_src_required",
                    "Every HTML img tag must have exactly one src attribute.",
                    line=line_number(text, match.start()),
                )
            )
        elif quoted_src_count != 1:
            issues.append(
                issue(
                    "quoted_image_src_required",
                    "Every HTML img tag must have a quoted src attribute.",
                    line=line_number(text, match.start()),
                )
            )

    for match in quoted_image_matches:
        src = html.unescape(match.group("src")).strip()
        issues.extend(local_asset_issues(path, src, line_number(text, match.start()), asset_roots))

    has_cover = bool(metadata.get("cover", "").strip())
    has_body_image = bool(quoted_image_matches or MARKDOWN_IMAGE_RE.search(text))
    if not has_cover and not has_body_image:
        issues.append(
            issue(
                "missing_cover_or_image",
                "Publishing requires a cover field or at least one body image.",
            )
        )

    for match in PLACEHOLDER_RE.finditer(text):
        issues.append(
            issue(
                "placeholder",
                f"Unresolved placeholder: {match.group(0)}",
                line=line_number(text, match.start()),
            )
        )

    plain_text = rendered_plain_text(body)
    for code, pattern in FORBIDDEN_PATTERNS:
        for match in pattern.finditer(plain_text):
            issues.append(
                issue(
                    code,
                    f"Blocked wording: {match.group(0)}",
                )
            )

    issues.append(
        issue(
            "manual_source_review",
            "A human or independent agent must still verify every factual claim against the source pack.",
            severity="warning",
        )
    )
    blockers = [item for item in issues if item["severity"] == "error"]
    return {
        "status": "FAIL" if blockers else "PASS",
        "article": str(path.resolve()),
        "title": metadata.get("title"),
        "author": metadata.get("author"),
        "blocker_count": len(blockers),
        "warning_count": len(issues) - len(blockers),
        "issues": issues,
    }


def check(name: str, status: str, message: str) -> dict[str, str]:
    return {"name": name, "status": status, "message": message}


def node_runtime_check() -> dict[str, str]:
    executable = shutil.which("node")
    if not executable:
        return check("node", "block", "not found")
    try:
        completed = subprocess.run(
            [executable, "--version"],
            check=False,
            capture_output=True,
            text=True,
            timeout=5,
        )
    except (OSError, subprocess.SubprocessError) as exc:
        return check("node", "block", f"version check failed: {exc}")
    version_text = (completed.stdout or completed.stderr).strip()
    match = re.fullmatch(r"v?(\d+)(?:\.\d+){1,2}", version_text)
    if completed.returncode != 0 or not match:
        return check("node", "block", f"unrecognized version output: {version_text or '<empty>'}")
    major = int(match.group(1))
    return check(
        "node",
        "pass" if major >= 18 else "block",
        f"{version_text} at {executable}; Node.js 18+ required",
    )


def doctor(project_root: Path, mode: str, image_dir: Path | None, index_path: Path | None) -> dict[str, Any]:
    checks: list[dict[str, str]] = []

    checks.append(
        check(
            "python",
            "pass" if sys.version_info >= (3, 10) else "block",
            f"Python {sys.version_info.major}.{sys.version_info.minor}.{sys.version_info.micro}",
        )
    )
    checks.append(
        check(
            "project_root",
            "pass" if project_root.is_dir() else "block",
            str(project_root.resolve()),
        )
    )

    article_dir = project_root / "articles"
    checks.append(
        check(
            "articles_directory",
            "pass" if article_dir.is_dir() else "warn",
            str(article_dir.resolve()),
        )
    )

    if mode in {"images", "full"}:
        image_dir = image_dir or project_root / "assets" / "article-images"
        index_path = index_path or project_root / "config" / "image-index.json"
        checks.append(
            check(
                "glm_api_key",
                "pass" if os.environ.get("GLM_API_KEY") else "block",
                "GLM_API_KEY is set" if os.environ.get("GLM_API_KEY") else "GLM_API_KEY is not set",
            )
        )
        checks.append(
            check(
                "image_directory",
                "pass" if image_dir.is_dir() else "block",
                str(image_dir.resolve()),
            )
        )
        checks.append(
            check(
                "image_index",
                "pass" if index_path.is_file() else "block",
                str(index_path.resolve()),
            )
        )

    if mode in {"publish", "full"}:
        checks.append(node_runtime_check())
        checks.append(check("npx", "pass" if shutil.which("npx") else "block", shutil.which("npx") or "not found"))
        checks.append(
            check(
                "wenyan_mcp_tool",
                "human",
                "Confirm mcp__wenyan-mcp__publish_article is visible in a restarted Codex task.",
            )
        )

    blockers = [item for item in checks if item["status"] == "block"]
    human = [item for item in checks if item["status"] == "human"]
    status = "FAIL" if blockers else ("NEEDS_HUMAN" if human else "PASS")
    return {
        "status": status,
        "mode": mode,
        "project_root": str(project_root.resolve()),
        "checks": checks,
    }


def require_external_confirmation(confirmed: bool) -> None:
    if not confirmed:
        raise WorkflowError(
            "External processing not confirmed. Review the data-transfer notice, "
            "then pass --confirm-external-processing."
        )


def api_post_json(url: str, api_key: str, payload: dict[str, Any], timeout: int = 45) -> dict[str, Any]:
    request = urllib.request.Request(
        url,
        data=json.dumps(payload, ensure_ascii=False).encode("utf-8"),
        headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
        method="POST",
    )
    opener = urllib.request.build_opener(NoRedirectHandler())
    try:
        with opener.open(request, timeout=timeout) as response:
            return json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        raise WorkflowError(f"Embedding API returned HTTP {exc.code}.") from exc
    except urllib.error.URLError as exc:
        raise WorkflowError(f"Embedding API request failed: {exc.reason}") from exc
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise WorkflowError("Embedding API returned an invalid JSON response.") from exc


def embedding_client(api_key: str, base_url: str, model: str) -> Callable[[str], list[float]]:
    endpoint = f"{base_url.rstrip('/')}/embeddings"

    def embed(text: str) -> list[float]:
        payload = api_post_json(endpoint, api_key, {"model": model, "input": text})
        try:
            values = payload["data"][0]["embedding"]
            return [float(value) for value in values]
        except (KeyError, IndexError, TypeError, ValueError) as exc:
            raise WorkflowError("Embedding API response did not contain a numeric embedding.") from exc

    return embed


def list_images(image_dir: Path) -> list[Path]:
    if not image_dir.is_dir():
        raise WorkflowError(f"Image directory does not exist: {image_dir}")
    images = sorted(
        (path for path in image_dir.rglob("*") if path.is_file() and path.suffix.lower() in IMAGE_SUFFIXES),
        key=lambda path: path.as_posix().lower(),
    )
    if not images:
        raise WorkflowError(f"No supported images found under: {image_dir}")
    return images


def build_index(image_dir: Path, output: Path, embed: Callable[[str], list[float]], model: str) -> dict[str, Any]:
    records: list[dict[str, Any]] = []
    for image_path in list_images(image_dir):
        description = re.sub(r"[_-]+", " ", image_path.stem).strip()
        records.append(
            {
                "relative_path": image_path.relative_to(image_dir).as_posix(),
                "filename": image_path.name,
                "description": description,
                "embedding": embed(description),
            }
        )
    payload = {
        "schema": INDEX_SCHEMA,
        "created_at": utc_now(),
        "embedding_model": model,
        "images": records,
    }
    atomic_write_json(output, payload)
    return {
        "status": "PASS",
        "image_count": len(records),
        "image_dir": str(image_dir.resolve()),
        "index": str(output.resolve()),
        "schema": INDEX_SCHEMA,
    }


def load_json(path: Path) -> Any:
    try:
        return json.loads(read_utf8(path))
    except json.JSONDecodeError as exc:
        raise WorkflowError(f"Invalid JSON file: {path}: {exc}") from exc


def legacy_records(payload: Any) -> Iterable[dict[str, Any]]:
    if isinstance(payload, dict) and payload.get("schema") == INDEX_SCHEMA:
        images = payload.get("images")
        if not isinstance(images, list):
            raise WorkflowError("Portable image index has no images list.")
        for record in images:
            if isinstance(record, dict):
                yield record
        return
    if isinstance(payload, dict):
        for key, value in payload.items():
            if isinstance(value, dict):
                record = dict(value)
                record.setdefault("filename", key)
                yield record
        return
    raise WorkflowError("Unsupported image index format.")


def migrate_index(legacy_index: Path, image_dir: Path, output: Path) -> dict[str, Any]:
    available: dict[str, list[Path]] = {}
    for path in list_images(image_dir):
        available.setdefault(path.name.casefold(), []).append(path)

    migrated: list[dict[str, Any]] = []
    missing: list[str] = []
    ambiguous: list[str] = []
    for record in legacy_records(load_json(legacy_index)):
        filename = str(record.get("filename") or Path(str(record.get("path", ""))).name).strip()
        matches = available.get(filename.casefold(), [])
        if not matches:
            missing.append(filename or "<missing filename>")
            continue
        if len(matches) > 1:
            ambiguous.append(filename)
            continue
        embedding = record.get("embedding")
        if not isinstance(embedding, list) or not embedding:
            missing.append(f"{filename} (missing embedding)")
            continue
        try:
            numeric_embedding = [float(value) for value in embedding]
        except (TypeError, ValueError):
            missing.append(f"{filename} (invalid embedding)")
            continue
        path = matches[0]
        migrated.append(
            {
                "relative_path": path.relative_to(image_dir).as_posix(),
                "filename": path.name,
                "description": str(record.get("description") or path.stem),
                "embedding": numeric_embedding,
            }
        )

    if missing or ambiguous:
        raise WorkflowError(
            "Index migration blocked. "
            f"Missing or invalid: {missing[:10]}; ambiguous filenames: {ambiguous[:10]}"
        )
    if not migrated:
        raise WorkflowError("Index migration found no usable image records.")

    payload = {
        "schema": INDEX_SCHEMA,
        "created_at": utc_now(),
        "embedding_model": "migrated-existing-embedding",
        "images": migrated,
    }
    atomic_write_json(output, payload)
    return {
        "status": "PASS",
        "image_count": len(migrated),
        "legacy_index": str(legacy_index.resolve()),
        "index": str(output.resolve()),
        "schema": INDEX_SCHEMA,
    }


def cosine_similarity(left: list[float], right: list[float]) -> float:
    if len(left) != len(right) or not left:
        return -1.0
    dot = sum(a * b for a, b in zip(left, right))
    left_norm = math.sqrt(sum(value * value for value in left))
    right_norm = math.sqrt(sum(value * value for value in right))
    if left_norm == 0 or right_norm == 0:
        return -1.0
    return dot / (left_norm * right_norm)


def portable_image_records(index_path: Path, image_dir: Path) -> list[dict[str, Any]]:
    payload = load_json(index_path)
    if not isinstance(payload, dict) or payload.get("schema") != INDEX_SCHEMA:
        raise WorkflowError("Image index is not portable. Run migrate-index first.")
    images = payload.get("images")
    if not isinstance(images, list):
        raise WorkflowError("Portable image index must contain an images list.")
    records: list[dict[str, Any]] = []
    for record in images:
        if not isinstance(record, dict):
            continue
        relative_path = str(record.get("relative_path", ""))
        relative = Path(relative_path)
        normalized_parts = relative_path.replace("\\", "/").split("/")
        if (
            not relative_path
            or relative.is_absolute()
            or re.match(r"^[A-Za-z]:[\\/]", relative_path)
            or relative_path.startswith(("\\\\", "//"))
            or ".." in normalized_parts
        ):
            raise WorkflowError(f"Image index path must be relative and local: {relative_path}")
        candidate = (image_dir / relative).resolve()
        try:
            candidate.relative_to(image_dir.resolve())
        except ValueError as exc:
            raise WorkflowError(f"Image index escapes the image directory: {relative_path}") from exc
        embedding = record.get("embedding")
        if not candidate.is_file():
            raise WorkflowError(f"Indexed image does not exist: {candidate}")
        if not isinstance(embedding, list) or not embedding:
            raise WorkflowError(f"Indexed image has no embedding: {relative_path}")
        try:
            numeric_embedding = [float(value) for value in embedding]
        except (TypeError, ValueError) as exc:
            raise WorkflowError(f"Indexed image has an invalid embedding: {relative_path}") from exc
        records.append(
            {
                "path": candidate,
                "filename": candidate.name,
                "description": str(record.get("description") or candidate.stem),
                "embedding": numeric_embedding,
            }
        )
    if not records:
        raise WorkflowError("Image index has no usable records.")
    return records


def paragraph_parts(body: str) -> list[str]:
    return re.split(r"(\r?\n(?:[ \t]*\r?\n)+)", body)


def eligible_paragraph(text: str, minimum_chars: int) -> bool:
    stripped = text.strip()
    if len(stripped) < minimum_chars:
        return False
    if stripped.startswith(("#", ">", "|", "```", "<")):
        return False
    if "<img" in stripped.lower() or AUTO_IMAGE_MARKER in stripped:
        return False
    return True


def existing_image_names(text: str) -> set[str]:
    names: set[str] = set()
    for match in HTML_IMAGE_RE.finditer(text):
        src = html.unescape(match.group("src"))
        names.add(Path(src.replace("\\", "/")).name.casefold())
    return names


def build_image_plan(
    body: str,
    records: list[dict[str, Any]],
    embed: Callable[[str], list[float]],
    *,
    max_images: int,
    min_score: float,
    paragraph_gap: int,
    max_candidates: int,
    minimum_chars: int,
) -> tuple[list[str], list[dict[str, Any]]]:
    parts = paragraph_parts(body)
    existing_names = existing_image_names(body)
    existing_auto = body.count(AUTO_IMAGE_MARKER)
    remaining = max(0, max_images - existing_auto)
    if remaining == 0:
        return parts, []

    paragraphs: list[tuple[int, int, str]] = []
    ordinal = 0
    for part_index in range(0, len(parts), 2):
        block = parts[part_index]
        if eligible_paragraph(block, minimum_chars):
            paragraphs.append((part_index, ordinal, block.strip()))
            ordinal += 1
        if len(paragraphs) >= max_candidates:
            break

    candidates: list[dict[str, Any]] = []
    for part_index, paragraph_ordinal, paragraph in paragraphs:
        paragraph_embedding = embed(paragraph)
        best: dict[str, Any] | None = None
        for record in records:
            if record["filename"].casefold() in existing_names:
                continue
            score = cosine_similarity(paragraph_embedding, record["embedding"])
            if best is None or score > best["score"]:
                best = {
                    "part_index": part_index,
                    "paragraph_ordinal": paragraph_ordinal,
                    "paragraph_preview": paragraph[:96],
                    "path": record["path"],
                    "filename": record["filename"],
                    "description": record["description"],
                    "score": score,
                }
        if best and best["score"] >= min_score:
            candidates.append(best)

    selected: list[dict[str, Any]] = []
    used_images: set[str] = set()
    for candidate in sorted(candidates, key=lambda item: item["score"], reverse=True):
        key = candidate["filename"].casefold()
        if key in used_images:
            continue
        if any(
            abs(candidate["paragraph_ordinal"] - item["paragraph_ordinal"]) <= paragraph_gap
            for item in selected
        ):
            continue
        selected.append(candidate)
        used_images.add(key)
        if len(selected) >= remaining:
            break
    selected.sort(key=lambda item: item["part_index"])
    return parts, selected


def update_cover(frontmatter: str, cover_path: str) -> str:
    normalized = cover_path.replace("\\", "/")
    yaml_value = json.dumps(normalized, ensure_ascii=False)
    if re.search(r"(?m)^cover\s*:", frontmatter):
        return re.sub(r"(?m)^cover\s*:.*$", f"cover: {yaml_value}", frontmatter, count=1)
    lines = frontmatter.splitlines()
    if not lines or lines[-1].strip() != "---":
        raise WorkflowError("Cannot update cover because frontmatter is malformed.")
    lines.insert(len(lines) - 1, f"cover: {yaml_value}")
    return "\n".join(lines)


def apply_image_plan(frontmatter: str, parts: list[str], plan: list[dict[str, Any]]) -> str:
    by_index = {item["part_index"]: item for item in plan}
    for part_index, item in by_index.items():
        source = item["path"].resolve().as_posix()
        alt = html.escape(str(item["description"]), quote=True)
        source_attr = html.escape(source, quote=True)
        image_tag = (
            f'{AUTO_IMAGE_MARKER}\n<img src="{source_attr}" alt="{alt}" '
            'style="border-radius: 8px; max-width: 100%;" />'
        )
        parts[part_index] = parts[part_index].rstrip() + "\n\n" + image_tag

    body = "".join(parts).lstrip("\r\n")
    if plan:
        frontmatter = update_cover(frontmatter, str(plan[0]["path"].resolve()))
    return frontmatter.rstrip() + "\n\n" + body


def add_images(
    article: Path,
    image_dir: Path,
    index_path: Path,
    embed: Callable[[str], list[float]],
    *,
    write: bool,
    max_images: int,
    min_score: float,
    paragraph_gap: int,
    max_candidates: int,
    minimum_chars: int,
) -> dict[str, Any]:
    text = read_utf8(article)
    frontmatter, metadata, body = parse_frontmatter(text)
    if not frontmatter:
        raise WorkflowError("Article must have valid frontmatter before adding images.")
    records = portable_image_records(index_path, image_dir)
    parts, plan = build_image_plan(
        body,
        records,
        embed,
        max_images=max_images,
        min_score=min_score,
        paragraph_gap=paragraph_gap,
        max_candidates=max_candidates,
        minimum_chars=minimum_chars,
    )
    if write and plan:
        atomic_write_text(article, apply_image_plan(frontmatter, parts, plan))

    public_plan = [
        {
            "paragraph_preview": item["paragraph_preview"],
            "image": str(item["path"].resolve()),
            "description": item["description"],
            "score": round(float(item["score"]), 6),
        }
        for item in plan
    ]
    next_step = (
        "Review semantic relevance, then rerun validation."
        if write
        else "Review the plan; rerun with --write to apply it."
    )
    return {
        "status": "PASS",
        "article": str(article.resolve()),
        "title": metadata.get("title"),
        "write_applied": bool(write and plan),
        "planned_image_count": len(plan),
        "plan": public_plan,
        "next_step": next_step,
    }


def emit(payload: dict[str, Any], as_json: bool) -> None:
    if as_json:
        print(json.dumps(payload, ensure_ascii=False, indent=2))
        return
    print(f"Status: {payload.get('status', 'UNKNOWN')}")
    for key, value in payload.items():
        if key != "status":
            print(f"{key}: {value}")


def add_common_json(parser: argparse.ArgumentParser) -> None:
    parser.add_argument("--json", action="store_true", help="Emit machine-readable JSON.")


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    subparsers = parser.add_subparsers(dest="command", required=True)

    doctor_parser = subparsers.add_parser("doctor", help="Check local prerequisites without reading secret values.")
    doctor_parser.add_argument("--project-root", default=os.environ.get("GZH_PROJECT_ROOT", "."))
    doctor_parser.add_argument("--mode", choices=("write", "images", "publish", "full"), default="write")
    doctor_parser.add_argument("--image-dir")
    doctor_parser.add_argument("--index")
    add_common_json(doctor_parser)

    validate_parser = subparsers.add_parser("validate", help="Run deterministic article publish checks.")
    validate_parser.add_argument("--article", required=True)
    validate_parser.add_argument(
        "--asset-root",
        action="append",
        default=[],
        help="Allowed root for local article images. Repeat for multiple roots.",
    )
    add_common_json(validate_parser)

    build_parser_ = subparsers.add_parser("build-index", help="Build a relative-path image embedding index.")
    build_parser_.add_argument("--image-dir", required=True)
    build_parser_.add_argument("--output", required=True)
    build_parser_.add_argument("--model", default="embedding-3")
    build_parser_.add_argument("--confirm-external-processing", action="store_true")
    add_common_json(build_parser_)

    migrate_parser = subparsers.add_parser("migrate-index", help="Convert an absolute-path legacy index.")
    migrate_parser.add_argument("--legacy-index", required=True)
    migrate_parser.add_argument("--image-dir", required=True)
    migrate_parser.add_argument("--output", required=True)
    add_common_json(migrate_parser)

    add_parser_ = subparsers.add_parser("add-images", help="Plan or atomically apply semantic image insertion.")
    add_parser_.add_argument("--article", required=True)
    add_parser_.add_argument("--image-dir", required=True)
    add_parser_.add_argument("--index", required=True)
    add_parser_.add_argument("--model", default="embedding-3")
    add_parser_.add_argument("--max-images", type=int, default=5)
    add_parser_.add_argument("--min-score", type=float, default=0.3)
    add_parser_.add_argument("--paragraph-gap", type=int, default=2)
    add_parser_.add_argument("--max-candidates", type=int, default=12)
    add_parser_.add_argument("--minimum-chars", type=int, default=80)
    add_parser_.add_argument("--confirm-external-processing", action="store_true")
    add_parser_.add_argument("--write", action="store_true")
    add_common_json(add_parser_)

    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    try:
        if args.command == "doctor":
            payload = doctor(
                Path(args.project_root),
                args.mode,
                Path(args.image_dir) if args.image_dir else None,
                Path(args.index) if args.index else None,
            )
        elif args.command == "validate":
            payload = validate_article(
                Path(args.article),
                [Path(root) for root in args.asset_root],
            )
        elif args.command == "build-index":
            require_external_confirmation(args.confirm_external_processing)
            api_key = os.environ.get(GLM_API_KEY_ENV)
            if not api_key:
                raise WorkflowError(f"Environment variable {GLM_API_KEY_ENV} is not set.")
            payload = build_index(
                Path(args.image_dir),
                Path(args.output),
                embedding_client(api_key, GLM_BASE_URL, args.model),
                args.model,
            )
        elif args.command == "migrate-index":
            payload = migrate_index(Path(args.legacy_index), Path(args.image_dir), Path(args.output))
        elif args.command == "add-images":
            require_external_confirmation(args.confirm_external_processing)
            api_key = os.environ.get(GLM_API_KEY_ENV)
            if not api_key:
                raise WorkflowError(f"Environment variable {GLM_API_KEY_ENV} is not set.")
            payload = add_images(
                Path(args.article),
                Path(args.image_dir),
                Path(args.index),
                embedding_client(api_key, GLM_BASE_URL, args.model),
                write=args.write,
                max_images=max(0, args.max_images),
                min_score=args.min_score,
                paragraph_gap=max(0, args.paragraph_gap),
                max_candidates=max(1, args.max_candidates),
                minimum_chars=max(1, args.minimum_chars),
            )
        else:  # pragma: no cover - argparse enforces a command.
            raise WorkflowError(f"Unsupported command: {args.command}")
    except WorkflowError as exc:
        payload = {"status": "FAIL", "error": str(exc)}

    emit(payload, args.json)
    return 0 if payload.get("status") in {"PASS", "NEEDS_HUMAN"} else 2


if __name__ == "__main__":
    raise SystemExit(main())
