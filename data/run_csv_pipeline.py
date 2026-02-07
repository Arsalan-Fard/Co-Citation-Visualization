import argparse
import shutil
import subprocess
import sys
from pathlib import Path


ROOT_DIR = Path(__file__).resolve().parent.parent
DATA_DIR = ROOT_DIR / "data"
PHASE1_DIR = ROOT_DIR / "Phase1"


def resolve_input_path(raw_path: str) -> Path:
    path = Path(raw_path)
    if path.is_absolute():
        return path
    return (ROOT_DIR / path).resolve()


def run_python_script(script_path: Path) -> None:
    cmd = [sys.executable, str(script_path)]
    print(f"Running: {' '.join(cmd)}")
    subprocess.run(cmd, cwd=ROOT_DIR, check=True)


def copy_required(src: Path, dst: Path) -> None:
    if not src.exists():
        raise FileNotFoundError(f"Required file was not created: {src}")
    dst.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(src, dst)


def ensure_non_empty_csv(path: Path) -> None:
    if not path.exists():
        raise FileNotFoundError(f"Missing output CSV: {path}")
    if path.stat().st_size == 0:
        raise RuntimeError(f"Output CSV is empty: {path}")


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Generate all visualization CSVs from a DOI text file."
    )
    parser.add_argument(
        "--doi-file",
        default="data/dois_hci.txt",
        help="Path to DOI .txt file (one DOI per line). Relative paths are from repo root.",
    )
    args = parser.parse_args()

    doi_file = resolve_input_path(args.doi_file)
    if not doi_file.exists():
        raise FileNotFoundError(f"DOI input file not found: {doi_file}")

    DATA_DIR.mkdir(parents=True, exist_ok=True)
    PHASE1_DIR.mkdir(parents=True, exist_ok=True)

    # Keep existing read labels if data/main_papers.csv already exists.
    existing_main_data = DATA_DIR / "main_papers.csv"
    root_main = ROOT_DIR / "main_papers.csv"
    if existing_main_data.exists():
        shutil.copy2(existing_main_data, root_main)

    # Search.py reads data/dois.txt, so overwrite it from the selected input file.
    shutil.copy2(doi_file, DATA_DIR / "dois.txt")

    run_python_script(DATA_DIR / "Search.py")
    copy_required(root_main, DATA_DIR / "main_papers.csv")

    # Reference generator expects Phase1/main_papers.csv
    copy_required(DATA_DIR / "main_papers.csv", PHASE1_DIR / "main_papers.csv")
    run_python_script(DATA_DIR / "create_reference_csv.py")
    copy_required(PHASE1_DIR / "references.csv", DATA_DIR / "references.csv")

    # Citation generator reads/writes in data/
    run_python_script(DATA_DIR / "create_citation_csv.py")

    # Co-citation generator expects Phase1/citation.csv
    copy_required(DATA_DIR / "citation.csv", PHASE1_DIR / "citation.csv")
    run_python_script(DATA_DIR / "create_cocitation_network.py")
    copy_required(PHASE1_DIR / "cocitation_network.csv", DATA_DIR / "cocitation_network.csv")

    # Bibliographic coupling generator expects Phase1/references.csv
    copy_required(DATA_DIR / "references.csv", PHASE1_DIR / "references.csv")
    run_python_script(DATA_DIR / "create_bibliographic_coupling.py")
    copy_required(
        PHASE1_DIR / "bibliographic_coupling_network.csv",
        DATA_DIR / "bibliographic_coupling_network.csv",
    )

    outputs = [
        DATA_DIR / "main_papers.csv",
        DATA_DIR / "references.csv",
        DATA_DIR / "citation.csv",
        DATA_DIR / "cocitation_network.csv",
        DATA_DIR / "bibliographic_coupling_network.csv",
    ]
    for output in outputs:
        ensure_non_empty_csv(output)

    print("Done. Generated visualization CSV files:")
    for output in outputs:
        print(f"- {output.relative_to(ROOT_DIR)}")


if __name__ == "__main__":
    main()
