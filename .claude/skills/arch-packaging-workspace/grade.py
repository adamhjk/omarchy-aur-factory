#!/usr/bin/env python3
"""Programmatic grader for arch-packaging evals.

Usage: python3 grade.py <iteration-dir>
Writes grading.json (expectations: text/passed/evidence) into each run dir.
"""
import json, re, subprocess, sys
from pathlib import Path


def sh(cmd, cwd=None):
    r = subprocess.run(cmd, shell=True, cwd=cwd, capture_output=True, text=True, timeout=120)
    return r.returncode, r.stdout + r.stderr


def _inside_build_dirs(p: Path, outputs: Path):
    return {"src", "pkg"} & set(p.relative_to(outputs).parts[:-1])


def find_pkgbuild(outputs: Path):
    cands = sorted(outputs.rglob("PKGBUILD"), key=lambda p: len(p.parts))
    for c in cands:
        if not _inside_build_dirs(c, outputs):
            return c
    return None


def find_pkgs(outputs: Path):
    return [p for p in outputs.rglob("*.pkg.tar.*")
            if "-debug-" not in p.name and not p.name.endswith(".sig")
            and not _inside_build_dirs(p, outputs)]


def pkg_filelist(pkg: Path):
    rc, out = sh(f"pacman -Qlp '{pkg}'")
    return [l.split(None, 1)[1].strip() for l in out.splitlines() if l.strip()] if rc == 0 else []


def srcinfo_of(pb: Path):
    rc, out = sh("makepkg --printsrcinfo", cwd=pb.parent)
    return (rc == 0), out


def fn_body(text, name):
    m = re.search(rf"{name}\s*\(\)\s*{{(.*?)^}}", text, re.S | re.M)
    return m.group(1) if m else ""


def grade_run(eval_name, outputs: Path, assertions):
    pb = find_pkgbuild(outputs)
    text = pb.read_text() if pb else ""
    pkgs = find_pkgs(outputs)
    files = pkg_filelist(pkgs[0]) if pkgs else []
    parses, srcinfo = srcinfo_of(pb) if pb else (False, "no PKGBUILD found")
    exp = []

    def add(t, passed, ev):
        exp.append({"text": t, "passed": bool(passed), "evidence": str(ev)[:400]})

    for a in assertions:
        al = a.lower()
        if "parses cleanly" in al:
            add(a, parses, "makepkg --printsrcinfo ok" if parses else srcinfo)
        elif "built package exists" in al:
            binname = {"c-makefile-sl": "/usr/bin/sl",
                       "rust-shellharden": "/usr/bin/shellharden",
                       "bin-lazydocker": "/usr/bin/lazydocker"}[eval_name]
            hit = binname in files
            add(a, pkgs and hit, f"pkgs={[p.name for p in pkgs]}, {binname} {'present' if hit else 'MISSING'}")
        elif "man page" in al:
            hits = [f for f in files if "/usr/share/man/man1/" in f and not f.endswith("/")]
            add(a, hits, hits or "no man1 files in package")
        elif "includes ncurses" in al:
            ok = re.search(r"^\s*depends=.*ncurses", text, re.M) or "depends = ncurses" in srcinfo
            add(a, ok, "ncurses in depends" if ok else "ncurses not in depends")
        elif "/usr/local" in al:
            bad = [f for f in files if re.match(r"^/(usr/local|bin/|sbin/)", f)]
            add(a, files and not bad, bad or "clean")
        elif "not skip" in al or "checksum is real" in al:
            sums = re.findall(r"^\s*(?:sha256|sha512|b2)sums(?:_\w+)?=\((.*?)\)", text, re.S | re.M)
            flat = " ".join(sums)
            ok = sums and "SKIP" not in flat and re.search(r"[0-9a-f]{64}", flat)
            add(a, ok, (flat[:120] if sums else "no sha256/sha512/b2 sums array"))
        elif "cargo fetch" in al:
            ok = "cargo fetch" in fn_body(text, "prepare") and "--locked" in fn_body(text, "prepare")
            add(a, ok, fn_body(text, "prepare").strip()[:200] or "no prepare()")
        elif "--frozen" in al:
            b = fn_body(text, "build")
            ok = "--frozen" in b or ("--locked" in b and "--offline" in b)
            add(a, ok, b.strip()[:200] or "no build()")
        elif "runs cargo test" in al:
            c = fn_body(text, "check")
            add(a, "cargo test" in c, c.strip()[:200] or "no check()")
        elif "gcc-libs" in al:
            ok = re.search(r"^\s*makedepends=.*(cargo|rust)", text, re.M) and "gcc-libs" in text
            add(a, ok, "cargo/rust makedepend + gcc-libs" if ok else "missing cargo makedepend or gcc-libs dep")
        elif "lazydocker-bin" in al:
            ok = (re.search(r"^pkgname=lazydocker-bin", text, re.M)
                  and re.search(r"^\s*provides=\([\"']?lazydocker", text, re.M)
                  and re.search(r"^\s*conflicts=\([\"']?lazydocker", text, re.M))
            add(a, ok, "pkgname/provides/conflicts ok" if ok else "missing -bin name or provides/conflicts")
        elif ":: syntax" in al:
            ok = re.search(r"^\s*source(?:_\w+)?=.*::", text, re.M)
            add(a, ok, "source uses ::" if ok else "no :: rename in source")
        elif "usr/share/licenses" in al:
            hits = [f for f in files if "/usr/share/licenses/" in f and not f.endswith("/")]
            add(a, hits, hits or "no license file in package")
        else:
            add(a, False, "UNGRADED: no rule for this assertion")
    return {"expectations": exp,
            "passed": sum(e["passed"] for e in exp), "total": len(exp)}


def main():
    it = Path(sys.argv[1])
    for meta_path in sorted(it.glob("*/eval_metadata.json")):
        meta = json.loads(meta_path.read_text())
        for cfg in ("with_skill", "without_skill", "old_skill"):
            outputs = meta_path.parent / cfg / "outputs"
            if not outputs.is_dir():
                continue
            g = grade_run(meta["eval_name"], outputs, meta["assertions"])
            (meta_path.parent / cfg / "grading.json").write_text(json.dumps(g, indent=2))
            print(f"{meta['eval_name']}/{cfg}: {g['passed']}/{g['total']}")


if __name__ == "__main__":
    main()
