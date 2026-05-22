"""Configuration for the model layer (the TA-only baseline classifier)."""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Optional

_PACKAGE_DIR = Path(__file__).resolve().parents[1]   # ta_pipeline/
_DEFAULT_MATRIX = _PACKAGE_DIR / "data" / "feature_matrix.parquet"
_DEFAULT_MODEL_DIR = _PACKAGE_DIR / "data" / "models"


@dataclass(frozen=True)
class ModelConfig:
    """Parameters for materializing the matrix and the walk-forward model run.

    The walk-forward fields are consumed from Phase M2 onward; M1 uses only the
    data paths.
    """

    # ---- data --------------------------------------------------------
    universe_file: Optional[str] = None      # None -> every ticker in the store
    matrix_path: Path = _DEFAULT_MATRIX      # cached feature + label matrix
    model_dir: Path = _DEFAULT_MODEL_DIR     # trained models + reports land here

    # ---- walk-forward CV (M2+) ---------------------------------------
    oos_months: int = 12                     # final untouched out-of-sample slice
    n_folds: int = 5                         # expanding-window CV folds before OOS
    embargo_bars: int = 10                   # purge gap = the label horizon
    calibration_tail_frac: float = 0.15      # temporally-held-out tail for calibration
    random_state: int = 42

    def __post_init__(self) -> None:
        if self.n_folds < 2:
            raise ValueError("n_folds must be >= 2")
        if self.oos_months < 1:
            raise ValueError("oos_months must be >= 1")
        if self.embargo_bars < 0:
            raise ValueError("embargo_bars must be >= 0")
        if not 0.0 < self.calibration_tail_frac < 1.0:
            raise ValueError("calibration_tail_frac must be in (0, 1)")
