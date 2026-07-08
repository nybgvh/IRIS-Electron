#!/usr/bin/env python3
"""Python wrapper around the R package **mvh** (My Virtual Herbarium,
https://github.com/tncvasconcelos/mvh).

mvh is an R package (a wrapper of rgbif). This script does NOT reimplement it —
it drives mvh's real R functions through `Rscript`:

    search_specimen_metadata(taxon_name, limit=...)   # GBIF specimen search
    download_specimen_images(metadata, dir_name=...)  # download the images

so the download is done by mvh itself.

Default run: download 100 RANDOM Liquidambar styraciflua herbarium specimen
images into examples/test_images/liquidambar_100/ (a larger pool is searched on
GBIF, then 100 records are sampled at random).

Usage:
    python3 mvh_download.py                       # 100 random L. styraciflua
    python3 mvh_download.py --n 50 --taxon "Vaccinium"
    python3 mvh_download.py --pool 1000 --seed 42
    python3 mvh_download.py --no-install          # skip the R dependency check

Requires R (Rscript on PATH). On the first run it installs the R side —
`remotes`, then mvh from GitHub (which pulls magick / rgbif / sf as CRAN
binaries). Use --no-install once those are present.
"""

import argparse
import os
import shutil
import subprocess
import sys
import tempfile

DEFAULT_TAXON = "Liquidambar styraciflua"
HERE = os.path.dirname(os.path.abspath(__file__))
DEFAULT_OUT = os.path.join(HERE, "test_images", "liquidambar_100")
CRAN = "https://cloud.r-project.org"

# R script driving mvh. Downloads ONE record at a time via mvh's real
# download_specimen_images() inside a tryCatch, validates each file is a real
# image (some GBIF media URLs are viewer HTML pages, not images), and keeps
# sampling random records until `n` valid images are saved. Tokens (__X__) are
# substituted in Python so literal R braces stay intact.
R_DOWNLOAD_TEMPLATE = r'''
suppressWarnings(suppressMessages(library(mvh)))
__SEED__

message("Searching GBIF for up to __POOL__ '__TAXONPLAIN__' specimen records with images...")
md <- search_specimen_metadata(taxon_name = __TAXON__, limit = __POOL__)
if (is.null(md) || nrow(md) == 0) stop("No specimens with images found for __TAXONPLAIN__.")
md <- md[!is.na(md$media_url) & nzchar(as.character(md$media_url)), , drop = FALSE]
cat("Found", nrow(md), "image records on GBIF.\n")

out_dir <- __OUTDIR__
n_target <- __NTARGET__
ord <- sample(nrow(md))                        # random order over all records
got <- 0L; used <- integer(0)
for (i in ord) {
  if (got >= n_target) break
  before <- list.files(out_dir)
  ok <- tryCatch({
    download_specimen_images(md[i, , drop = FALSE], dir_name = out_dir,
                             result_file_name = tempfile(), timeout_limit = __TL__)
    TRUE
  }, error = function(e) { message("  skip: ", conditionMessage(e)); FALSE })
  newf <- setdiff(list.files(out_dir), before)
  goodfile <- FALSE
  for (nf in newf) {
    p <- file.path(out_dir, nf)
    valid <- tryCatch({ magick::image_read(p); TRUE }, error = function(e) FALSE)
    if (isTRUE(valid)) goodfile <- TRUE else unlink(p)   # drop non-image (e.g. HTML) downloads
  }
  if (isTRUE(ok) && goodfile) { got <- got + 1L; used <- c(used, i) }
}

if (length(used) > 0) {
  keep <- intersect(c("scientificName","gbifID","institutionCode","catalogNumber","country",
                      "decimalLatitude","decimalLongitude","license","media_url"), colnames(md))
  write.csv(md[used, keep, drop = FALSE], file = paste0(__RESULT__, ".csv"), row.names = FALSE)
}
cat("\nSAVED", got, "valid images to", out_dir, "\n")
if (got < n_target) cat("NOTE: only", got, "of", n_target, "requested were downloadable (bad/duplicate URLs skipped).\n")
'''


def find_rscript():
    rs = shutil.which("Rscript")
    if not rs:
        sys.exit("ERROR: Rscript not found on PATH. Install R from https://www.r-project.org/ first.")
    return rs


def r_str(s):
    """Embed a Python string as an R double-quoted string literal."""
    return '"' + str(s).replace("\\", "\\\\").replace('"', '\\"') + '"'


def run_r(rscript, code, timeout=None):
    """Write R code to a temp file and run it, streaming output to the console."""
    with tempfile.NamedTemporaryFile("w", suffix=".R", delete=False) as f:
        f.write(code)
        path = f.name
    try:
        return subprocess.run([rscript, "--vanilla", path], timeout=timeout).returncode
    finally:
        os.unlink(path)


def ensure_packages(rscript, timeout):
    """Install the R side (remotes -> mvh, which pulls magick/rgbif/sf) if absent."""
    code = f"""
options(repos = c(CRAN = {r_str(CRAN)}))
have <- rownames(installed.packages())
if (!("remotes" %in% have)) install.packages("remotes")
if (!("mvh" %in% have)) {{
  message("Installing mvh from GitHub (pulls magick, rgbif, sf)...")
  remotes::install_github("tncvasconcelos/mvh", upgrade = "never", dependencies = TRUE)
}}
suppressWarnings(suppressMessages(library(mvh)))
cat("mvh ready\\n")
"""
    print("[mvh] checking / installing R packages (first run can take a few minutes)...")
    rc = run_r(rscript, code, timeout=timeout)
    if rc != 0:
        sys.exit("ERROR: failed to install or load the R package 'mvh'. "
                 "Check the R output above (sf/magick need CRAN binaries or system libs).")


def normalize_extension(out_dir, to_ext=".jpg"):
    """mvh always writes images as `.jpeg`; rename them to `.jpg` (or to_ext).
    Idempotent and collision-safe."""
    renamed = 0
    for name in sorted(os.listdir(out_dir)):
        low = name.lower()
        if not (low.endswith(".jpeg") or low.endswith(".jpe")):
            continue
        stem = os.path.splitext(name)[0]
        src = os.path.join(out_dir, name)
        dst = os.path.join(out_dir, stem + to_ext)
        if os.path.abspath(src) == os.path.abspath(dst):
            continue
        if os.path.exists(dst):
            k = 1
            while os.path.exists(os.path.join(out_dir, f"{stem}_{k}{to_ext}")):
                k += 1
            dst = os.path.join(out_dir, f"{stem}_{k}{to_ext}")
        os.rename(src, dst)
        renamed += 1
    return renamed


def download(rscript, taxon, n, out_dir, result_file, pool, seed, timeout_limit, timeout):
    os.makedirs(out_dir, exist_ok=True)
    seed_line = f"set.seed({int(seed)})" if seed is not None else "# no fixed seed (fully random)"
    # Plain (escaped) taxon text for embedding INSIDE R double-quoted strings.
    taxon_plain = str(taxon).replace("\\", "\\\\").replace('"', '\\"')
    code = (R_DOWNLOAD_TEMPLATE
            .replace("__SEED__", seed_line)
            .replace("__TAXONPLAIN__", taxon_plain)
            .replace("__TAXON__", r_str(taxon))
            .replace("__POOL__", str(int(pool)))
            .replace("__OUTDIR__", r_str(out_dir))
            .replace("__NTARGET__", str(int(n)))
            .replace("__TL__", str(int(timeout_limit)))
            .replace("__RESULT__", r_str(result_file)))
    print(f"[mvh] searching + downloading {n} random '{taxon}' images -> {out_dir}")
    rc = run_r(rscript, code, timeout=timeout)
    if rc != 0:
        sys.exit("ERROR: the mvh download step failed (see R output above).")
    # mvh writes .jpeg; normalize the whole folder to .jpg
    renamed = normalize_extension(out_dir, ".jpg")
    print(f"[mvh] normalized {renamed} .jpeg files to .jpg")


def main():
    ap = argparse.ArgumentParser(description="Download random GBIF herbarium images via the R package mvh.")
    ap.add_argument("--taxon", default=DEFAULT_TAXON, help='Scientific name (default: "Liquidambar styraciflua").')
    ap.add_argument("--n", type=int, default=100, help="Number of random images to download (default: 100).")
    ap.add_argument("--out-dir", default=DEFAULT_OUT, help="Destination directory for the images.")
    ap.add_argument("--result-file", default=None, help="Path (no extension) for the metadata CSV.")
    ap.add_argument("--pool", type=int, default=600,
                    help="How many GBIF records to search before random-sampling (default: 600).")
    ap.add_argument("--seed", type=int, default=None, help="Random seed for a reproducible sample (default: none).")
    ap.add_argument("--timeout-limit", type=int, default=300, help="Per-download timeout in seconds (mvh arg).")
    ap.add_argument("--proc-timeout", type=int, default=1800, help="Overall subprocess timeout in seconds.")
    ap.add_argument("--no-install", action="store_true", help="Skip the R dependency install/check.")
    args = ap.parse_args()

    if args.pool < args.n:
        args.pool = args.n  # need at least n records to sample from

    out_dir = os.path.abspath(args.out_dir)
    result_file = args.result_file or (out_dir.rstrip("/\\") + "_results")

    rscript = find_rscript()
    if not args.no_install:
        ensure_packages(rscript, timeout=args.proc_timeout)
    download(rscript, args.taxon, args.n, out_dir, result_file,
             args.pool, args.seed, args.timeout_limit, timeout=args.proc_timeout)
    print("[mvh] done.")


if __name__ == "__main__":
    main()
