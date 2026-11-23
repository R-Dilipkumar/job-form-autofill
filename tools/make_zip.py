"""Packs the extension into dist/job-form-autofill-<version>.zip for the Chrome Web Store.

Run: python -I tools/make_zip.py
Only the files Chrome needs go in (no tests, tools, docs or store images).
"""
import json
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PARTS = ["manifest.json", "src", "popup", "options", "icons"]


def main() -> None:
    version = json.loads((ROOT / "manifest.json").read_text(encoding="utf-8"))["version"]
    out = ROOT / "dist" / f"job-form-autofill-{version}.zip"
    out.parent.mkdir(exist_ok=True)
    files = []
    for part in PARTS:
        p = ROOT / part
        files += [p] if p.is_file() else sorted(f for f in p.rglob("*") if f.is_file())
    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as z:
        for f in files:
            z.write(f, f.relative_to(ROOT).as_posix())
    with zipfile.ZipFile(out) as z:
        bad = z.testzip()
        if bad:
            raise SystemExit(f"Zip check failed at {bad}")
        names = z.namelist()
    print(f"{out} ({out.stat().st_size} bytes, {len(names)} files)")
    for n in names:
        print("  ", n)


if __name__ == "__main__":
    main()
