"""Rule A sessionization tests.

An event is attributed to the first trading day whose 16:00 ET close it
precedes: regular hours -> same day, after-hours -> next trading day,
weekend / holiday -> next trading day, past the last candle -> NaT.
"""

import pandas as pd

from ta_pipeline.flow.sessionize import add_feature_date

# Trading calendar: two business weeks, 2026-05-04 (Mon) .. 2026-05-15 (Fri).
# 2026-05-09 / 05-10 are the weekend gap. May is EDT, so ET = UTC - 4.
_CAL = pd.bdate_range("2026-05-04", "2026-05-15")


def _feature_date(utc_timestamp):
    """The Rule A feature_date for a single event at ``utc_timestamp`` (UTC)."""
    events = pd.DataFrame({"time": pd.to_datetime([utc_timestamp], utc=True)})
    return add_feature_date(events, "time", _CAL)["feature_date"].iloc[0]


def test_regular_hours_same_day():
    # 18:00 UTC = 14:00 EDT on Wed 2026-05-06 -> that day.
    assert _feature_date("2026-05-06 18:00") == pd.Timestamp("2026-05-06")


def test_premarket_same_day():
    # 12:00 UTC = 08:00 EDT -> before the close, still that day.
    assert _feature_date("2026-05-06 12:00") == pd.Timestamp("2026-05-06")


def test_exactly_at_close_is_same_day():
    # 20:00:00 UTC = 16:00:00 EDT exactly -> not "after" the close.
    assert _feature_date("2026-05-06 20:00:00") == pd.Timestamp("2026-05-06")


def test_after_close_rolls_to_next_trading_day():
    # 20:30 UTC = 16:30 EDT on Wed -> rolls forward to Thu 2026-05-07.
    assert _feature_date("2026-05-06 20:30") == pd.Timestamp("2026-05-07")


def test_weekend_rolls_to_monday():
    # Saturday 2026-05-09 13:00 EDT -> next trading day Mon 2026-05-11.
    assert _feature_date("2026-05-09 17:00") == pd.Timestamp("2026-05-11")


def test_friday_after_close_rolls_to_monday():
    # Fri 2026-05-08 16:30 EDT -> Saturday base -> Mon 2026-05-11.
    assert _feature_date("2026-05-08 20:30") == pd.Timestamp("2026-05-11")


def test_past_last_candle_is_nat():
    # After the calendar's last trading day (Fri 2026-05-15) -> NaT.
    assert pd.isna(_feature_date("2026-05-18 18:00"))


def test_empty_events_get_feature_date_column():
    empty = pd.DataFrame({"time": pd.Series([], dtype="datetime64[ns, UTC]")})
    out = add_feature_date(empty, "time", _CAL)
    assert "feature_date" in out.columns
    assert len(out) == 0
