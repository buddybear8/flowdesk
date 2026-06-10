"""Sessionize flow / dark-pool events onto trading-day feature rows (Rule A).

Rule A: an event is attributed to the first trading day whose 16:00 ET close
the event precedes. A trade during regular hours (or pre-market) of a trading
day lands on that day; an after-hours trade, or one on a weekend or holiday,
rolls forward to the next trading day. This makes every flow / dark-pool
feature exactly the information available at the labeler's ``close[t]``
entry -- no event the model sees at row ``t`` can post-date that entry.

The close is taken as 16:00 ET for every trading day; the ~3 early-close
half-days a year would mis-bucket afternoon events, which is left uncorrected.
"""

from __future__ import annotations

import numpy as np
import pandas as pd

# Regular-session close, in seconds since ET midnight.
_CLOSE_SECONDS = 16 * 3600
_ET = "US/Eastern"


def _trading_day_array(trading_days) -> np.ndarray:
    """Sorted, unique, naive-midnight ``datetime64`` array of trading dates."""
    idx = pd.DatetimeIndex(pd.to_datetime(pd.Index(trading_days)))
    if idx.tz is not None:
        idx = idx.tz_localize(None)
    return np.sort(idx.normalize().unique().to_numpy())


def add_feature_date(
    events: pd.DataFrame, ts_col: str, trading_days
) -> pd.DataFrame:
    """Return ``events`` with a ``feature_date`` column assigned by Rule A.

    Parameters
    ----------
    events : DataFrame carrying a tz-aware UTC timestamp column ``ts_col``.
    ts_col : timestamp column name -- ``time`` for flow, ``executed_at`` for
        dark pool.
    trading_days : the trading-day calendar (e.g. the candle store's dates).

    ``feature_date`` is naive ``datetime64`` at midnight, matching the TA
    matrix ``date`` column. Events after the last trading day get ``NaT`` --
    they have no entry bar yet and are dropped at the join.
    """
    out = events.copy()
    if out.empty:
        out["feature_date"] = pd.Series([], dtype="datetime64[ns]")
        return out

    et = pd.to_datetime(out[ts_col], utc=True).dt.tz_convert(_ET)
    et_date = et.dt.normalize().dt.tz_localize(None)
    secs = et.dt.hour * 3600 + et.dt.minute * 60 + et.dt.second
    after_close = secs > _CLOSE_SECONDS

    # After-hours events look for a close strictly later than their own date.
    base = et_date + pd.to_timedelta(after_close.astype("int64"), unit="D")

    td = _trading_day_array(trading_days)
    idx = np.searchsorted(td, base.to_numpy(), side="left")
    in_range = idx < len(td)

    feature_date = np.full(len(out), np.datetime64("NaT", "ns"))
    feature_date[in_range] = td[idx[in_range]]
    out["feature_date"] = feature_date
    return out
