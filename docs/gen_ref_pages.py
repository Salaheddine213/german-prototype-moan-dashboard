"""Auto-generate API reference pages for every Python module under dashboard/backend/app.

Walked by mkdocs-gen-files at build time; emits one virtual `.md` per module plus a
SUMMARY.md consumed by mkdocs-literate-nav so the sidebar matches the package tree.
"""
from __future__ import annotations

from pathlib import Path

import mkdocs_gen_files

REPO_ROOT = Path(__file__).resolve().parent.parent
SRC_ROOT = REPO_ROOT / "dashboard" / "backend"
PKG_ROOT = SRC_ROOT / "app"

nav = mkdocs_gen_files.Nav()

for path in sorted(PKG_ROOT.rglob("*.py")):
    module_path = path.relative_to(SRC_ROOT).with_suffix("")
    doc_path = path.relative_to(SRC_ROOT).with_suffix(".md")
    full_doc_path = Path("reference", doc_path)

    parts = tuple(module_path.parts)
    if parts[-1] == "__init__":
        parts = parts[:-1]
        doc_path = doc_path.with_name("index.md")
        full_doc_path = full_doc_path.with_name("index.md")
    elif parts[-1] == "__main__":
        continue

    if not parts:
        continue

    nav[parts] = doc_path.as_posix()

    with mkdocs_gen_files.open(full_doc_path, "w") as fd:
        ident = ".".join(parts)
        fd.write(f"# `{ident}`\n\n::: {ident}\n")

# Landing page for the reference section so `reference/index.md` resolves.
with mkdocs_gen_files.open("reference/index.md", "w") as fd:
    fd.write(
        "# API reference\n\n"
        "Auto-generated documentation for every module under "
        "`dashboard/backend/app/`. Use the sidebar to browse the package tree.\n"
    )

# Literate-nav SUMMARY: put the landing page first, then the auto-walked tree.
with mkdocs_gen_files.open("reference/SUMMARY.md", "w") as nav_file:
    nav_file.write("- [Overview](index.md)\n")
    nav_file.writelines(nav.build_literate_nav())
