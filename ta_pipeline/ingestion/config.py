"""Configuration for the candlestick ingestion layer."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date, timedelta
from pathlib import Path
from typing import Optional, Tuple

# The store lives under the package so the package's .gitignore covers it.
_PACKAGE_DIR = Path(__file__).resolve().parents[1]   # ta_pipeline/
_DEFAULT_DATA_DIR = _PACKAGE_DIR / "data"

# Brief §2.4 — keep the backfill worker count conservative.
MAX_WORKERS_CAP = 10


@dataclass(frozen=True)
class IngestionConfig:
    """Parameters for the Polygon.io daily-candle backfill and update."""

    # ---- ticker universe (supply ONE of these) -------------------------
    tickers: Tuple[str, ...] = ()           # inline list
    universe_file: Optional[str] = None     # path: one ticker per line or CSV

    # ---- date range ----------------------------------------------------
    years_back: int = 10
    start: Optional[str] = None             # ISO override; default today - years_back
    end: Optional[str] = None               # ISO override; default today

    # ---- storage -------------------------------------------------------
    data_dir: Path = _DEFAULT_DATA_DIR

    # ---- fetch behaviour ----------------------------------------------
    adjusted: bool = True                   # split-adjusted bars (brief §1)
    max_workers: int = 8                    # <= MAX_WORKERS_CAP
    max_retries: int = 5
    retry_backoff_seconds: float = 1.0      # initial backoff; doubles each retry

    def __post_init__(self) -> None:
        if not 1 <= self.max_workers <= MAX_WORKERS_CAP:
            raise ValueError(f"max_workers must be in [1, {MAX_WORKERS_CAP}]")
        if self.years_back < 1:
            raise ValueError("years_back must be >= 1")
        if self.tickers and self.universe_file:
            raise ValueError("set tickers OR universe_file, not both")

    @property
    def candles_dir(self) -> Path:
        """Directory holding the per-ticker parquet files."""
        return Path(self.data_dir) / "candles"

    @property
    def manifest_path(self) -> Path:
        """Path to the CSV manifest (human-inspectable backfill summary)."""
        return Path(self.data_dir) / "manifest.csv"

    def resolve_universe(self) -> list:
        """The ticker universe, from the inline list or the universe file.

        The file may be one ticker per line or comma-separated; blank lines, a
        leading ``ticker`` header and ``#`` comments are skipped.
        """
        if self.universe_file:
            text = Path(self.universe_file).read_text()
            raw = text.replace(",", "\n").splitlines()
            tickers = [
                line.strip().upper()
                for line in raw
                if line.strip()
                and not line.strip().startswith("#")
                and line.strip().lower() != "ticker"
            ]
        else:
            tickers = [t.strip().upper() for t in self.tickers if t.strip()]
        return list(dict.fromkeys(tickers))   # dedupe, preserve order

    def resolve_dates(self) -> Tuple[str, str]:
        """(start, end) ISO date strings for the backfill range."""
        end = self.end or date.today().isoformat()
        if self.start:
            start = self.start
        else:
            span = timedelta(days=round(365.25 * self.years_back))
            start = (date.today() - span).isoformat()
        return start, end


def add_cli_arguments(parser) -> None:
    """Register the shared ingestion CLI arguments on an argparse parser."""
    parser.add_argument("--universe-file", help="path: one ticker per line / CSV")
    parser.add_argument("--tickers", help="comma-separated ticker list")
    parser.add_argument("--years", type=int, default=10, help="years of history")
    parser.add_argument("--data-dir", help="store location (default: package data/)")
    parser.add_argument("--workers", type=int, default=8, help="concurrent workers")


def config_from_cli_args(args) -> "IngestionConfig":
    """Build an IngestionConfig from parsed CLI args (see add_cli_arguments)."""
    kwargs = dict(years_back=args.years, max_workers=args.workers)
    if args.universe_file:
        kwargs["universe_file"] = args.universe_file
    elif args.tickers:
        kwargs["tickers"] = tuple(
            t.strip() for t in args.tickers.split(",") if t.strip()
        )
    if args.data_dir:
        kwargs["data_dir"] = Path(args.data_dir)
    return IngestionConfig(**kwargs)
