from __future__ import annotations

import csv
import re
from pathlib import Path


def _find_data_start(lines: list[str]) -> int:
    for index, line in enumerate(lines):
        if re.match(r"^\d", line):
            return index
    raise ValueError("No data rows found in input.")


def _split_row(line: str) -> list[str]:
    parts = re.split(r"\t+|\s{2,}", line.strip())
    parts = [part.strip() for part in parts if part.strip()]
    return parts


def _normalize(value: str) -> str:
    return value.replace(" ", "")


def convert_markdown_to_csv(input_path: Path, output_path: Path) -> None:
    raw_lines = input_path.read_text(encoding="utf-8").splitlines()
    lines = [line.strip() for line in raw_lines if line.strip()]

    data_start = _find_data_start(lines)

    header = [
        "Ansiotulo (€/vuosi)",
        "Kk-palkka (€)",
        "Verot ja maksut (€/v)",
        "Vero-prosentti",
        "Marginaali-vero",
        "Nettotulo (€/v)",
    ]

    rows: list[list[str]] = []
    for line in lines[data_start:]:
        parts = _split_row(line)
        if len(parts) != len(header):
            raise ValueError(f"Unexpected column count ({len(parts)}) in line: {line}")
        rows.append([_normalize(value) for value in parts])

    with output_path.open("w", encoding="utf-8", newline="") as csv_file:
        writer = csv.writer(csv_file, delimiter=";")
        writer.writerow(header)
        writer.writerows(rows)


if __name__ == "__main__":
    workspace_root = Path(__file__).resolve().parent
    convert_markdown_to_csv(
        workspace_root / "asd.md",
        workspace_root / "asd.csv",
    )
