"""Marketplace CLI (Track 3): review/install/uninstall/list packs.

Usage:
    python3 -m harness.market.cli review <bundle.htepak>
    python3 -m harness.market.cli install <bundle.htepak> [--root DIR]
    python3 -m harness.market.cli uninstall <name@version> [--root DIR]
    python3 -m harness.market.cli list [--root DIR]
    python3 -m harness.market.cli create <source-dir> <out.htepak>
"""

import argparse
import json
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", ".."))

from harness.market.packs import (  # noqa: E402
    create_pack,
    enabled_payloads,
    install_pack,
    set_enabled,
    uninstall_pack,
)
from harness.market.review import review_pack  # noqa: E402

DEFAULT_ROOT = os.path.join(os.path.dirname(__file__), "..", "marketplace")


def cmd_review(args: argparse.Namespace) -> int:
    report = review_pack(args.bundle)
    print(json.dumps({k: v for k, v in report.items() if k != "manifest"}, indent=1))
    if report["manifest"]:
        print(f"pack: {report['manifest']['name']}@{report['manifest']['version']}")
    return 0 if report["pass"] else 1


def cmd_install(args: argparse.Namespace) -> int:
    errors: list = []
    pack_id = install_pack(args.root, args.bundle, errors)
    if pack_id is None:
        print(f"install failed: {errors[0] if errors else 'unknown'}")
        return 1
    print(f"installed {pack_id}")
    return 0


def cmd_uninstall(args: argparse.Namespace) -> int:
    errors: list = []
    if not uninstall_pack(args.root, args.pack_id, errors):
        print(f"uninstall failed: {errors[0] if errors else 'unknown'}")
        return 1
    print(f"uninstalled {args.pack_id}")
    return 0


def cmd_list(args: argparse.Namespace) -> int:
    for payload in enabled_payloads(args.root):
        print(f"{payload['pack_id']} [{payload['kind']}] {payload['entry']}")
    return 0


def cmd_enable(args: argparse.Namespace) -> int:
    ok = set_enabled(args.root, args.pack_id, args.enable)
    print(
        ("enabled " if args.enable else "disabled ") + args.pack_id
        if ok
        else "unknown pack"
    )
    return 0 if ok else 1


def cmd_create(args: argparse.Namespace) -> int:
    try:
        result = create_pack(args.source_dir, args.out)
    except ValueError as exc:
        print(f"create failed: {exc}")
        return 1
    print(f"created {result['path']} ({result['sha256'][:12]}…) ")
    return 0


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description="Heretek extension marketplace CLI")
    parser.add_argument("--root", default=DEFAULT_ROOT, help="marketplace root dir")
    sub = parser.add_subparsers(dest="command", required=True)
    root_parent = argparse.ArgumentParser(add_help=False)
    root_parent.add_argument(
        "--root", default=DEFAULT_ROOT, help="marketplace root dir"
    )
    review = sub.add_parser("review", parents=[root_parent])
    review.add_argument("bundle")
    review.set_defaults(func=cmd_review)
    install = sub.add_parser("install", parents=[root_parent])
    install.add_argument("bundle")
    install.set_defaults(func=cmd_install)
    uninstall = sub.add_parser("uninstall", parents=[root_parent])
    uninstall.add_argument("pack_id")
    uninstall.set_defaults(func=cmd_uninstall)
    listing = sub.add_parser("list", parents=[root_parent])
    listing.set_defaults(func=cmd_list)
    enable = sub.add_parser("enable", parents=[root_parent])
    enable.add_argument("pack_id")
    enable.add_argument("--disable", action="store_true")
    enable.set_defaults(
        func=lambda a: cmd_enable(
            argparse.Namespace(root=a.root, pack_id=a.pack_id, enable=not a.disable)
        )
    )
    create = sub.add_parser("create", parents=[root_parent])
    create.add_argument("source_dir")
    create.add_argument("out")
    create.set_defaults(func=cmd_create)
    args = parser.parse_args(argv)
    return args.func(args)


if __name__ == "__main__":
    raise SystemExit(main())
