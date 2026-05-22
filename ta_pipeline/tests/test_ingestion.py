"""Ingestion layer — data-quality flags, the managed store, backfill / update.

These tests use a fake Polygon client and a temporary store; no API key or
network is needed.
"""

from types import SimpleNamespace

import pandas as pd

from ta_pipeline.ingestion import (
    CANDLE_COLUMNS,
    IngestionConfig,
    append_candles,
    deprecate_ticker,
    load_candles,
    manifest_row,
    quality_flags,
    read_candles,
    read_manifest,
    run_backfill,
    run_update,
    split_at_largest_gap,
    stitch_predecessor,
    trim_reused_ticker,
    write_candles,
    write_manifest,
)


def _candles(ticker, dates, *, volume=1e6, base=100.0):
    return pd.DataFrame({
        "ticker": ticker,
        "date": pd.to_datetime(dates),
        "open": base, "high": base + 1.0, "low": base - 1.0, "close": base + 0.5,
        "volume": volume, "vwap": base + 0.2, "transactions": 5000,
    })[CANDLE_COLUMNS]


def _fake_client(calendar):
    """A Polygon-like client whose list_aggs yields bars within [start, end]."""
    def list_aggs(ticker, mult, span, start, end, **kwargs):
        lo, hi = pd.Timestamp(start), pd.Timestamp(end)
        for d in calendar:
            if lo <= d <= hi:
                yield SimpleNamespace(
                    timestamp=int(d.value // 10**6),
                    open=10.0, high=11.0, low=9.0, close=10.5,
                    volume=1e6, vwap=10.2, transactions=100,
                )
    return SimpleNamespace(list_aggs=list_aggs)


# --- quality flags -------------------------------------------------------

def test_quality_flags_clean_series():
    df = _candles("AAA", pd.bdate_range("2015-06-01", "2025-05-30"))
    assert quality_flags(df, "2015-06-01", "2025-05-31") == []


def test_quality_flags_empty():
    empty = pd.DataFrame(columns=CANDLE_COLUMNS)
    assert quality_flags(empty, "2015-01-01", "2025-01-01") == ["empty"]


def test_quality_flags_short_history_and_stale():
    df = _candles("AAA", pd.bdate_range("2022-01-03", "2022-12-30"))
    flags = quality_flags(df, "2015-01-01", "2025-01-01")
    assert "short_history" in flags and "stale" in flags


def test_quality_flags_zero_volume_and_price():
    df = _candles("AAA", pd.bdate_range("2015-06-01", "2025-05-30"))
    df.loc[df.index[10], "volume"] = 0
    df.loc[df.index[20], "low"] = 0.0
    flags = quality_flags(df, "2015-06-01", "2025-05-31")
    assert "zero_volume_rows" in flags and "zero_price_rows" in flags


def test_quality_flags_gaps():
    full = pd.bdate_range("2015-06-01", "2025-05-30")
    df = _candles("AAA", full[::3])          # only a third of the trading days
    assert "gaps" in quality_flags(df, "2015-06-01", "2025-05-31")


# --- managed store -------------------------------------------------------

def test_append_is_incremental_and_deduped(tmp_path):
    cfg = IngestionConfig(tickers=("AAA",), data_dir=tmp_path)
    write_candles(cfg, "AAA", _candles("AAA", pd.bdate_range("2020-01-01", periods=50)))
    later = pd.bdate_range("2020-01-01", periods=60)
    merged = append_candles(cfg, "AAA", _candles("AAA", later[45:], base=200.0))
    assert len(merged) == 60
    assert merged["date"].is_unique and merged["date"].is_monotonic_increasing
    # the 5 overlapping dates resolve keep=last -> the incoming bars (base 200) win
    assert (merged.iloc[45:50]["close"] == 200.5).all()


def test_load_candles_slices_the_store(tmp_path):
    cfg = IngestionConfig(tickers=("AAA",), data_dir=tmp_path)
    write_candles(cfg, "AAA", _candles("AAA", pd.bdate_range("2020-01-01", periods=200)))
    sliced = load_candles("AAA", start="2020-03-01", end="2020-04-01", cfg=cfg)
    assert not sliced.empty
    assert sliced["date"].min() >= pd.Timestamp("2020-03-01")
    assert sliced["date"].max() <= pd.Timestamp("2020-04-01")
    assert load_candles("MISSING", cfg=cfg).empty


# --- backfill + incremental update --------------------------------------

def test_backfill_writes_store_and_manifest(tmp_path):
    calendar = pd.bdate_range("2020-01-01", periods=120)
    cfg = IngestionConfig(
        tickers=("AAA", "BBB"), data_dir=tmp_path, max_workers=2,
        start="2020-01-01", end=str(calendar[-1].date()),
    )
    manifest = run_backfill(cfg, client=_fake_client(calendar))
    assert set(manifest["ticker"]) == {"AAA", "BBB"}
    assert (manifest["rows"] == 120).all()
    assert cfg.manifest_path.exists()
    assert len(load_candles("AAA", cfg=cfg)) == 120


def test_update_appends_only_new_bars(tmp_path):
    calendar = pd.bdate_range("2024-01-01", "2024-06-30")
    fake = _fake_client(calendar)

    backfilled = IngestionConfig(
        tickers=("AAA",), data_dir=tmp_path,
        start="2024-01-01", end="2024-03-29",
    )
    run_backfill(backfilled, client=fake)
    before = len(load_candles("AAA", cfg=backfilled))

    updated = IngestionConfig(
        tickers=("AAA",), data_dir=tmp_path,
        start="2024-01-01", end="2024-06-28",
    )
    run_update(updated, client=fake)
    after = load_candles("AAA", cfg=updated)
    assert len(after) > before
    assert after["date"].is_unique and after["date"].is_monotonic_increasing


# --- repair: ticker-symbol-reuse trim -----------------------------------

def test_split_at_largest_gap_finds_the_reuse_seam():
    old = pd.bdate_range("2016-01-01", periods=60)
    new = pd.bdate_range("2019-01-01", periods=300)
    pre, post, gap = split_at_largest_gap(_candles("RE", old.append(new)), 45)
    assert gap > 45
    assert len(pre) == 60 and len(post) == 300
    assert post["date"].min() == new[0]


def test_split_at_largest_gap_ignores_normal_weekends():
    pre, post, gap = split_at_largest_gap(
        _candles("CLEAN", pd.bdate_range("2020-01-01", periods=400)), 45
    )
    assert len(pre) == 0 and len(post) == 400


def test_trim_reused_ticker_keeps_the_post_gap_segment(tmp_path):
    cfg = IngestionConfig(tickers=("RE",), data_dir=tmp_path)
    old = pd.bdate_range("2016-01-01", periods=50)
    new = pd.bdate_range("2020-01-01", periods=400)
    write_candles(cfg, "RE", _candles("RE", old.append(new)))
    res = trim_reused_ticker(cfg, "RE")
    assert res["action"] == "trimmed" and res["rows_after"] == 400
    kept = read_candles(cfg, "RE")
    assert len(kept) == 400 and kept["date"].min() == new[0]


def test_trim_reused_ticker_refuses_a_tail_seam(tmp_path):
    # symbol vacated: the wanted history is the LARGE early segment, so a
    # post-gap trim would be destructive -- the repair must refuse.
    cfg = IngestionConfig(tickers=("GG",), data_dir=tmp_path)
    big = pd.bdate_range("2016-01-01", periods=400)
    tiny = pd.bdate_range("2020-01-01", periods=20)
    write_candles(cfg, "GG", _candles("GG", big.append(tiny)))
    res = trim_reused_ticker(cfg, "GG")
    assert res["action"].startswith("refused")
    assert len(read_candles(cfg, "GG")) == 420   # store left untouched


def test_stitch_predecessor_prepends_and_relabels(tmp_path):
    calendar = pd.bdate_range("2020-01-01", "2023-12-29")
    fake = _fake_client(calendar)
    cfg = IngestionConfig(tickers=("NEW",), data_dir=tmp_path,
                          start="2020-01-01", end="2023-12-29")
    # successor "NEW" holds only the recent slice; "OLD" is its predecessor
    succ_dates = calendar[calendar >= pd.Timestamp("2023-01-01")]
    write_candles(cfg, "NEW", _candles("NEW", succ_dates))
    before = len(read_candles(cfg, "NEW"))
    res = stitch_predecessor(cfg, "NEW", "OLD", client=fake)
    assert res["action"] == "stitched"
    stitched = read_candles(cfg, "NEW")
    assert len(stitched) > before
    assert (stitched["ticker"] == "NEW").all()              # predecessor relabelled
    assert stitched["date"].is_unique and stitched["date"].is_monotonic_increasing
    assert stitched["date"].min() < pd.Timestamp("2023-01-01")  # history prepended


def test_deprecate_ticker_removes_store_universe_and_manifest(tmp_path):
    uni = tmp_path / "universe.txt"
    uni.write_text("AAA\nBBB\n")
    cfg = IngestionConfig(universe_file=str(uni), data_dir=tmp_path)
    for t in ("AAA", "BBB"):
        write_candles(cfg, t, _candles(t, pd.bdate_range("2020-01-01", periods=30)))
    write_manifest(cfg, [manifest_row(t, read_candles(cfg, t)) for t in ("AAA", "BBB")])

    res = deprecate_ticker(cfg, "AAA")
    assert res["parquet_removed"] and res["manifest_row_removed"]
    assert res["universe_removed"]
    assert read_candles(cfg, "AAA").empty                       # parquet gone
    assert "AAA" not in set(read_manifest(cfg)["ticker"].astype(str))
    assert cfg.resolve_universe() == ["BBB"]
    # idempotent -- a second call is a no-op
    assert deprecate_ticker(cfg, "AAA")["parquet_removed"] is False
